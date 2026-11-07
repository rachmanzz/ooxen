import { KNOWN_CONTENT_TYPES } from '../opc/content-types.js';
import { createPackage, type OpcPackage } from '../opc/package.js';
import { KNOWN_RELATIONSHIPS, type OpcRelationship } from '../opc/relationships.js';
import type { CommentNode, DocumentMetadata, FootnoteNode } from '../types/ast.js';
import { defaultCommentBuilder, type CommentBuilder } from './comment-builder.js';
import { defaultFootnoteBuilder, type FootnoteBuilder } from './footnote-builder.js';
import { defaultMetadataBuilder, type MetadataBuilder } from './metadata-builder.js';
import { defaultNumberingBuilder, type NumberingBuilder } from './numbering-builder.js';
import { defaultStylesBuilder, type StylesBuilder } from './styles-builder.js';

const textEncoder = new TextEncoder();

export interface ImageMediaPart {
  partName: string;
  relationshipId: string;
  contentType: string;
  data: Uint8Array;
}

export interface HeaderFooterPart {
  partName: string;
  relationshipId: string;
  type: 'header' | 'footer';
  xml: string;
}

/**
 * Assembles generated parts into a valid OPC container package.
 */

export interface PackageBuilder {
  assemblePackage(
    documentXml: string,
    customStylesXml?: string,
    customNumberingXml?: string,
    mediaParts?: ImageMediaPart[],
    headerFooterParts?: HeaderFooterPart[],
    externalRelationships?: OpcRelationship[],
    metadata?: DocumentMetadata,
    footnotes?: FootnoteNode[],
    endnotes?: FootnoteNode[],
    customFootnotesXml?: string,
    customEndnotesXml?: string,
    comments?: CommentNode[],
    customCommentsXml?: string,
    requiredNumIds?: ReadonlyMap<number, string | undefined>,
  ): OpcPackage;
}

export class StandardPackageBuilder implements PackageBuilder {
  private stylesBuilder: StylesBuilder;
  private numberingBuilder: NumberingBuilder;
  private metadataBuilder: MetadataBuilder;
  private footnoteBuilder: FootnoteBuilder;
  private commentBuilder: CommentBuilder;

  constructor(
    stylesBuilder: StylesBuilder = defaultStylesBuilder,
    numberingBuilder: NumberingBuilder = defaultNumberingBuilder,
    metadataBuilder: MetadataBuilder = defaultMetadataBuilder,
    footnoteBuilder: FootnoteBuilder = defaultFootnoteBuilder,
    commentBuilder: CommentBuilder = defaultCommentBuilder,
  ) {
    this.stylesBuilder = stylesBuilder;
    this.numberingBuilder = numberingBuilder;
    this.metadataBuilder = metadataBuilder;
    this.footnoteBuilder = footnoteBuilder;
    this.commentBuilder = commentBuilder;
  }

  assemblePackage(
    documentXml: string,
    customStylesXml?: string,
    customNumberingXml?: string,
    mediaParts: ImageMediaPart[] = [],
    headerFooterParts: HeaderFooterPart[] = [],
    externalRelationships: OpcRelationship[] = [],
    metadata?: DocumentMetadata,
    footnotes?: FootnoteNode[],
    endnotes?: FootnoteNode[],
    customFootnotesXml?: string,
    customEndnotesXml?: string,
    comments?: CommentNode[],
    customCommentsXml?: string,
    requiredNumIds?: ReadonlyMap<number, string | undefined>,
  ): OpcPackage {
    const pkg = createPackage();

    // Caller-supplied relationship ids (media, headers/footers, hyperlinks)
    // are emitted as-is. Allocate this builder's own ids for the document,
    // styles, and numbering relationships from the remaining free space so
    // they can never collide with caller ids — addRelationship() deduplicates
    // by id, which would silently drop one of the two relationships (v2 N2).
    const usedRelIds = new Set<string>(['rIdFootnotes', 'rIdEndnotes', 'rIdCore', 'rIdApp', 'rIdComments']);
    for (const id of [
      ...mediaParts.map((m) => m.relationshipId),
      ...headerFooterParts.map((h) => h.relationshipId),
      ...externalRelationships.map((r) => r.id),
    ]) {
      if (id) usedRelIds.add(id);
    }
    const nextRelId = (): string => {
      let n = 1;
      while (usedRelIds.has(`rId${n}`)) n++;
      const id = `rId${n}`;
      usedRelIds.add(id);
      return id;
    };

    // 1. Root Relationship to document.xml
    pkg.addRelationship(undefined, {
      id: nextRelId(),
      type: KNOWN_RELATIONSHIPS.DOCUMENT,
      target: 'word/document.xml',
    });

    // 2. Add word/document.xml part
    pkg.setPart({
      name: 'word/document.xml',
      contentType: KNOWN_CONTENT_TYPES.WML_DOCUMENT_MAIN,
      data: textEncoder.encode(documentXml),
    });

    // 3. Add styles.xml part & relationship
    const stylesXml = customStylesXml ?? this.stylesBuilder.buildDefaultStylesXml();
    pkg.addRelationship('word/document.xml', {
      id: nextRelId(),
      type: KNOWN_RELATIONSHIPS.STYLES,
      target: 'styles.xml',
    });

    pkg.setPart({
      name: 'word/styles.xml',
      contentType: KNOWN_CONTENT_TYPES.WML_STYLES,
      data: textEncoder.encode(stylesXml),
    });

    // 4. Add numbering.xml if document contains numbering references or custom numbering provided
    if (customNumberingXml || documentXml.includes('<w:numPr>') || (requiredNumIds && requiredNumIds.size > 0)) {
      const numXml = customNumberingXml ?? this.numberingBuilder.buildDefaultNumberingXml(requiredNumIds);
      pkg.addRelationship('word/document.xml', {
        id: nextRelId(),
        type: KNOWN_RELATIONSHIPS.NUMBERING,
        target: 'numbering.xml',
      });

      pkg.setPart({
        name: 'word/numbering.xml',
        contentType: KNOWN_CONTENT_TYPES.WML_NUMBERING,
        data: textEncoder.encode(numXml),
      });
    }

    // 5. Add binary media parts and relationships
    for (const media of mediaParts) {
      const relTarget = media.partName.replace(/^word\//, '');
      pkg.addRelationship('word/document.xml', {
        id: media.relationshipId,
        type: KNOWN_RELATIONSHIPS.IMAGE,
        target: relTarget,
      });

      pkg.setPart({
        name: media.partName,
        contentType: media.contentType,
        data: media.data,
      });
    }

    // 6. Add header and footer parts and relationships
    for (const hf of headerFooterParts) {
      const relTarget = hf.partName.replace(/^word\//, '');
      pkg.addRelationship('word/document.xml', {
        id: hf.relationshipId,
        type: hf.type === 'header' ? KNOWN_RELATIONSHIPS.HEADER : KNOWN_RELATIONSHIPS.FOOTER,
        target: relTarget,
      });

      pkg.setPart({
        name: hf.partName,
        contentType: hf.type === 'header' ? KNOWN_CONTENT_TYPES.WML_HEADER : KNOWN_CONTENT_TYPES.WML_FOOTER,
        data: textEncoder.encode(hf.xml),
      });
    }

    // 7. Add external relationships (such as external hyperlinks)
    for (const rel of externalRelationships) {
      pkg.addRelationship('word/document.xml', rel);
    }

    // 8. Add footnotes if provided or custom XML provided
    if (customFootnotesXml || (footnotes && footnotes.length > 0)) {
      const fnXml = customFootnotesXml ?? this.footnoteBuilder.buildFootnotesXml(footnotes ?? []);
      pkg.addRelationship('word/document.xml', {
        id: 'rIdFootnotes',
        type: KNOWN_RELATIONSHIPS.FOOTNOTES,
        target: 'footnotes.xml',
      });
      pkg.setPart({
        name: 'word/footnotes.xml',
        contentType: KNOWN_CONTENT_TYPES.WML_FOOTNOTES,
        data: textEncoder.encode(fnXml),
      });
    }

    // 9. Add endnotes if provided or custom XML provided
    if (customEndnotesXml || (endnotes && endnotes.length > 0)) {
      const enXml = customEndnotesXml ?? this.footnoteBuilder.buildEndnotesXml(endnotes ?? []);
      pkg.addRelationship('word/document.xml', {
        id: 'rIdEndnotes',
        type: KNOWN_RELATIONSHIPS.ENDNOTES,
        target: 'endnotes.xml',
      });
      pkg.setPart({
        name: 'word/endnotes.xml',
        contentType: KNOWN_CONTENT_TYPES.WML_ENDNOTES,
        data: textEncoder.encode(enXml),
      });
    }

    // 10. Add document metadata (docProps/core.xml & docProps/app.xml) if provided
    if (metadata) {
      const coreXml = this.metadataBuilder.buildCorePropertiesXml(metadata);
      pkg.addRelationship(undefined, {
        id: 'rIdCore',
        type: KNOWN_RELATIONSHIPS.CORE_PROPERTIES,
        target: 'docProps/core.xml',
      });
      pkg.setPart({
        name: 'docProps/core.xml',
        contentType: KNOWN_CONTENT_TYPES.CORE_PROPERTIES,
        data: textEncoder.encode(coreXml),
      });

      const appXml = this.metadataBuilder.buildAppPropertiesXml(metadata);
      pkg.addRelationship(undefined, {
        id: 'rIdApp',
        type: KNOWN_RELATIONSHIPS.EXTENDED_PROPERTIES,
        target: 'docProps/app.xml',
      });
      pkg.setPart({
        name: 'docProps/app.xml',
        contentType: KNOWN_CONTENT_TYPES.EXTENDED_PROPERTIES,
        data: textEncoder.encode(appXml),
      });
    }

    // 11. Add comments if provided or custom XML provided
    if (customCommentsXml || (comments && comments.length > 0)) {
      const cXml = customCommentsXml ?? this.commentBuilder.buildCommentsXml(comments ?? []);
      pkg.addRelationship('word/document.xml', {
        id: 'rIdComments',
        type: KNOWN_RELATIONSHIPS.COMMENTS,
        target: 'comments.xml',
      });
      pkg.setPart({
        name: 'word/comments.xml',
        contentType: KNOWN_CONTENT_TYPES.WML_COMMENTS,
        data: textEncoder.encode(cXml),
      });
    }

    return pkg;
  }
}

export const defaultPackageBuilder = new StandardPackageBuilder();
