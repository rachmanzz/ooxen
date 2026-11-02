import { KNOWN_CONTENT_TYPES } from '../opc/content-types.js';
import { createPackage, type OpcPackage } from '../opc/package.js';
import { KNOWN_RELATIONSHIPS } from '../opc/relationships.js';
import { defaultNumberingBuilder, type NumberingBuilder } from './numbering-builder.js';
import { defaultStylesBuilder, type StylesBuilder } from './styles-builder.js';

const textEncoder = new TextEncoder();

export interface ImageMediaPart {
  partName: string;
  relationshipId: string;
  contentType: string;
  data: Uint8Array;
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
  ): OpcPackage;
}

export class StandardPackageBuilder implements PackageBuilder {
  private stylesBuilder: StylesBuilder;
  private numberingBuilder: NumberingBuilder;

  constructor(
    stylesBuilder: StylesBuilder = defaultStylesBuilder,
    numberingBuilder: NumberingBuilder = defaultNumberingBuilder,
  ) {
    this.stylesBuilder = stylesBuilder;
    this.numberingBuilder = numberingBuilder;
  }

  assemblePackage(
    documentXml: string,
    customStylesXml?: string,
    customNumberingXml?: string,
    mediaParts: ImageMediaPart[] = [],
  ): OpcPackage {
    const pkg = createPackage();

    // 1. Root Relationship to document.xml
    pkg.addRelationship(undefined, {
      id: 'rId1',
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
      id: 'rId2',
      type: KNOWN_RELATIONSHIPS.STYLES,
      target: 'styles.xml',
    });

    pkg.setPart({
      name: 'word/styles.xml',
      contentType: KNOWN_CONTENT_TYPES.WML_STYLES,
      data: textEncoder.encode(stylesXml),
    });

    // 4. Add numbering.xml if document contains numbering references or custom numbering provided
    if (customNumberingXml || documentXml.includes('<w:numPr>')) {
      const numXml = customNumberingXml ?? this.numberingBuilder.buildDefaultNumberingXml();
      pkg.addRelationship('word/document.xml', {
        id: 'rId3',
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

    return pkg;
  }
}

export const defaultPackageBuilder = new StandardPackageBuilder();
