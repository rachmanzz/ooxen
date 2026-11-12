import type {
  BlockNode,
  ColumnProperties,
  CommentNode,
  DocumentMetadata,
  DocumentNode,
  FootnoteNode,
  HeaderFooterNode,
  HeaderFooterType,
  SectionHeaders,
  SectionFooters,
  SectionNode,
  SectionProperties,
} from '../../types/ast.js';
import { twipsToPt } from '../../types/common.js';
import { openPackage, resolvePartTarget, type OpcPackage } from '../../opc/package.js';
import { loadEmbeddedFonts } from '../../fonts/font-table-loader.js';
import { KNOWN_RELATIONSHIPS, type OpcRelationship } from '../../opc/relationships.js';
import { parsePackageMetadata } from '../metadata/metadata-parser.js';
import { defaultXmlAdapter, type XmlNode } from '../xml-adapter.js';
import { parseWithMarkupCompatibility } from '../mce.js';
import type { ImageResolver } from '../dml/image-parser.js';
import { parseCommentsXml } from './comment-parser.js';
import { parseSdtContentBlocks } from './sdt-parser.js';
import { parseEndnotesXml, parseFootnotesXml } from './footnote-parser.js';
import { parseHeaderFooterNode, type HeaderFooterResolver } from './header-footer-parser.js';
import { StandardNumberingResolver, type NumberingResolver } from './numbering-resolver.js';
import { defaultParagraphParser, type HyperlinkResolver, type ParagraphParser } from './paragraph-parser.js';
import { StandardStyleResolver, type StyleResolver } from './style-resolver.js';
import { defaultTableParser, type TableParser } from './table-parser.js';

/**
 * Top-level WordprocessingML document parser (w:document & w:body) according to ISO/IEC 29500-1.
 */

export interface DocumentParser {
  parseDocument(
    rootNode: XmlNode,
    styleResolver?: StyleResolver,
    numberingResolver?: NumberingResolver,
    imageResolver?: ImageResolver,
    headerFooterResolver?: HeaderFooterResolver,
    hyperlinkResolver?: HyperlinkResolver,
    metadata?: DocumentMetadata,
    footnotes?: FootnoteNode[],
    endnotes?: FootnoteNode[],
    comments?: CommentNode[],
  ): DocumentNode;
  parseDocumentXml(
    xmlString: string,
    styleResolver?: StyleResolver,
    numberingResolver?: NumberingResolver,
    imageResolver?: ImageResolver,
    headerFooterResolver?: HeaderFooterResolver,
    hyperlinkResolver?: HyperlinkResolver,
    metadata?: DocumentMetadata,
    footnotes?: FootnoteNode[],
    endnotes?: FootnoteNode[],
    comments?: CommentNode[],
  ): DocumentNode;
  parsePackage(pkg: OpcPackage): DocumentNode;
}

export function parseSectionHeaderFooterReferences(
  sectPrNode?: XmlNode,
  resolver?: HeaderFooterResolver,
): { headers?: SectionHeaders; footers?: SectionFooters } {
  if (!sectPrNode || !resolver) return {};

  const headers: SectionHeaders = {};
  const footers: SectionFooters = {};

  for (const child of sectPrNode.children) {
    const tag = child.nodeName.replace(/^[a-zA-Z0-9]+:/, '').toLowerCase();

    if (tag === 'headerreference') {
      const type = (child.attributes['w:type'] ?? child.attributes['type'] ?? 'default').toLowerCase() as HeaderFooterType;
      const relId = child.attributes['r:id'] ?? child.attributes['id'] ?? child.attributes['w:id'];
      if (relId) {
        const resolved = resolver.resolveHeader(relId);
        if (resolved) {
          headers[type] = resolved;
        }
      }
    } else if (tag === 'footerreference') {
      const type = (child.attributes['w:type'] ?? child.attributes['type'] ?? 'default').toLowerCase() as HeaderFooterType;
      const relId = child.attributes['r:id'] ?? child.attributes['id'] ?? child.attributes['w:id'];
      if (relId) {
        const resolved = resolver.resolveFooter(relId);
        if (resolved) {
          footers[type] = resolved;
        }
      }
    }
  }

  return {
    headers: Object.keys(headers).length > 0 ? headers : undefined,
    footers: Object.keys(footers).length > 0 ? footers : undefined,
  };
}

/**
 * Parses a twips attribute, keeping the current value when the input is
 * missing or malformed (F-NAN): `Number('garbage')` is NaN, and NaN page
 * geometry would poison every downstream layout computation.
 */
function finiteTwips(raw: string | undefined, current: number): number {
  if (!raw) return current;
  const value = twipsToPt(Number(raw));
  return Number.isFinite(value) ? value : current;
}

export function parseSectionProperties(node?: XmlNode): SectionProperties {
  // Default Letter page: 8.5 x 11 inches = 612 x 792 pt, 1 inch margins = 72 pt
  const props: SectionProperties = {
    pageSize: { width: 612, height: 792 },
    margins: { top: 72, right: 72, bottom: 72, left: 72 },
  };

  if (!node) return props;

  for (const child of node.children) {
    const tag = child.nodeName.replace(/^[a-zA-Z0-9]+:/, '').toLowerCase();

    if (tag === 'pgsz') {
      const w = child.attributes['w:w'] ?? child.attributes['w'];
      const h = child.attributes['w:h'] ?? child.attributes['h'];
      const orient = (child.attributes['w:orient'] ?? child.attributes['orient'])?.toLowerCase();
      props.pageSize.width = finiteTwips(w, props.pageSize.width);
      props.pageSize.height = finiteTwips(h, props.pageSize.height);
      if (orient === 'landscape' || orient === 'portrait') {
        props.orientation = orient;
      }
    } else if (tag === 'type') {
      const val = child.attributes['w:val'] ?? child.attributes['val'];
      if (val) {
        const lower = val.toLowerCase();
        if (lower === 'continuous') props.type = 'continuous';
        else if (lower === 'nextpage') props.type = 'nextPage';
        else if (lower === 'evenpage') props.type = 'evenPage';
        else if (lower === 'oddpage') props.type = 'oddPage';
        else if (lower === 'nextcolumn') props.type = 'nextColumn';
      }
    } else if (tag === 'pgnumtype') {
      const start = child.attributes['w:start'] ?? child.attributes['start'];
      const fmt = child.attributes['w:fmt'] ?? child.attributes['fmt'];
      const startNum = start ? Number(start) : undefined;
      props.pageNumbering = {
        start: startNum !== undefined && Number.isFinite(startNum) ? startNum : undefined,
        format: fmt,
      };
    } else if (tag === 'pgmar') {
      const top = child.attributes['w:top'] ?? child.attributes['top'];
      const right = child.attributes['w:right'] ?? child.attributes['right'];
      const bottom = child.attributes['w:bottom'] ?? child.attributes['bottom'];
      const left = child.attributes['w:left'] ?? child.attributes['left'];
      const header = child.attributes['w:header'] ?? child.attributes['header'];
      const footer = child.attributes['w:footer'] ?? child.attributes['footer'];

      props.margins.top = finiteTwips(top, props.margins.top);
      props.margins.right = finiteTwips(right, props.margins.right);
      props.margins.bottom = finiteTwips(bottom, props.margins.bottom);
      props.margins.left = finiteTwips(left, props.margins.left);
      props.headerDistancePt = header ? finiteTwips(header, props.headerDistancePt ?? 36) : props.headerDistancePt;
      props.footerDistancePt = footer ? finiteTwips(footer, props.footerDistancePt ?? 36) : props.footerDistancePt;
    } else if (tag === 'titlepg') {
      props.titlePg = true;
    } else if (tag === 'cols') {
      const numAttr = child.attributes['w:num'] ?? child.attributes['num'];
      const spaceAttr = child.attributes['w:space'] ?? child.attributes['space'];
      const equalWidthAttr = child.attributes['w:equalWidth'] ?? child.attributes['equalWidth'];
      const sepAttr = child.attributes['w:sep'] ?? child.attributes['sep'];

      const countRaw = numAttr ? Number(numAttr) : 1;
      const count = Number.isFinite(countRaw) ? countRaw : 1;
      const spacePt = finiteTwips(spaceAttr, 36);
      const equalWidth = equalWidthAttr !== undefined ? !(equalWidthAttr === '0' || equalWidthAttr === 'false') : true;
      const separator = sepAttr === '1' || sepAttr === 'true';

      const colDefs: ColumnProperties[] = [];
      for (const colChild of child.children) {
        const colTag = colChild.nodeName.replace(/^[a-zA-Z0-9]+:/, '').toLowerCase();
        if (colTag === 'col') {
          const colW = colChild.attributes['w:w'] ?? colChild.attributes['w'];
          const colSpace = colChild.attributes['w:space'] ?? colChild.attributes['space'];
          if (colW) {
            const widthPt = finiteTwips(colW, NaN);
            if (Number.isFinite(widthPt)) {
              const colSpacePt = colSpace ? finiteTwips(colSpace, NaN) : undefined;
              colDefs.push({ widthPt, ...(Number.isFinite(colSpacePt) ? { spacePt: colSpacePt } : {}) });
            }
          }
        }
      }

      props.columns = {
        count: Math.max(1, count),
        spacePt,
        equalWidth,
        separator: separator || undefined,
        columns: colDefs.length > 0 ? colDefs : undefined,
      };
    }
  }

  return props;
}

/**
 * Resolves a relationship target against its source part (so a target
 * that climbs with ../ lands where OPC says it does). Some writers store
 * targets already rooted ("word/styles.xml"): joining those against the
 * source directory would produce "word/word/..." and miss the part
 * (v2 N10), so a target that already names an existing part wins.
 */
function resolveRelTarget(pkg: OpcPackage, sourcePart: string, target: string): string {
  const resolved = resolvePartTarget(sourcePart, target);
  if (pkg.getPart(resolved)) return resolved;
  const rooted = target.replace(/^\/+/, '');
  return pkg.getPart(rooted) ? rooted : resolved;
}

function resolveWordPartPath(pkg: OpcPackage, sourcePart: string, target: string | undefined, fallback: string): string {
  if (!target) return fallback;
  return resolveRelTarget(pkg, sourcePart, target);
}

export class StandardDocumentParser implements DocumentParser {
  private paragraphParser: ParagraphParser;
  private tableParser: TableParser;

  constructor(
    paragraphParser: ParagraphParser = defaultParagraphParser,
    tableParser: TableParser = defaultTableParser,
  ) {
    this.paragraphParser = paragraphParser;
    this.tableParser = tableParser;
  }

  parseDocumentXml(
    xmlString: string,
    styleResolver?: StyleResolver,
    numberingResolver?: NumberingResolver,
    imageResolver?: ImageResolver,
    headerFooterResolver?: HeaderFooterResolver,
    hyperlinkResolver?: HyperlinkResolver,
    metadata?: DocumentMetadata,
    footnotes?: FootnoteNode[],
    endnotes?: FootnoteNode[],
    comments?: CommentNode[],
  ): DocumentNode {
    const rootNode = parseWithMarkupCompatibility(xmlString, (xml) => defaultXmlAdapter.parse(xml));
    return this.parseDocument(
      rootNode,
      styleResolver,
      numberingResolver,
      imageResolver,
      headerFooterResolver,
      hyperlinkResolver,
      metadata,
      footnotes,
      endnotes,
      comments,
    );
  }

  parseDocument(
    rootNode: XmlNode,
    styleResolver?: StyleResolver,
    numberingResolver?: NumberingResolver,
    imageResolver?: ImageResolver,
    headerFooterResolver?: HeaderFooterResolver,
    hyperlinkResolver?: HyperlinkResolver,
    metadata?: DocumentMetadata,
    footnotes?: FootnoteNode[],
    endnotes?: FootnoteNode[],
    comments?: CommentNode[],
    customStylesXml?: string,
    customNumberingXml?: string,
  ): DocumentNode {
    // Find w:body
    let bodyNode: XmlNode | undefined;
    if (rootNode.nodeName.toLowerCase().endsWith('body')) {
      bodyNode = rootNode;
    } else {
      bodyNode = rootNode.children.find((c) => c.nodeName.toLowerCase().endsWith('body'));
    }

    if (!bodyNode) {
      return {
        type: 'document',
        sections: [
          {
            type: 'section',
            properties: parseSectionProperties(),
            children: [],
          },
        ],
        metadata,
        footnotes,
        endnotes,
        comments,
        customStylesXml,
        customNumberingXml,
      };
    }

    const sections: SectionNode[] = [];
    let currentBlocks: BlockNode[] = [];

    for (const child of bodyNode.children) {
      const tag = child.nodeName.replace(/^[a-zA-Z0-9]+:/, '').toLowerCase();

      if (tag === 'p') {
        const paragraph = this.paragraphParser.parseParagraph(
          child,
          styleResolver,
          numberingResolver,
          imageResolver,
          hyperlinkResolver,
        );
        // Floating shape textboxes surface as sibling blocks right after
        // their anchor paragraph (see drainPendingBlocks).
        const extraBlocks = this.paragraphParser.drainPendingBlocks?.() ?? [];

        // Check if paragraph contains section break in pPr
        const pPr = child.children.find((c) => c.nodeName.toLowerCase().endsWith('ppr'));
        const sectPr = pPr?.children.find((c) => c.nodeName.toLowerCase().endsWith('sectpr'));
        if (sectPr) {
          // The paragraph carrying w:sectPr is the section delimiter itself.
          // When it has no content (the common case emitted by the writer),
          // it must not also become a content block, or round-tripping
          // duplicates an empty paragraph at every section boundary.
          if (paragraph.children.length > 0) {
            currentBlocks.push(paragraph);
          }
          currentBlocks.push(...extraBlocks);
          const { headers, footers } = parseSectionHeaderFooterReferences(sectPr, headerFooterResolver);
          sections.push({
            type: 'section',
            properties: parseSectionProperties(sectPr),
            children: currentBlocks,
            headers,
            footers,
          });
          currentBlocks = [];
        } else {
          currentBlocks.push(paragraph, ...extraBlocks);
        }
      } else if (tag === 'tbl') {
        const table = this.tableParser.parseTable(child, styleResolver, numberingResolver);
        currentBlocks.push(table);
      } else if (tag === 'sdt') {
        // Content controls unwrap to their authored blocks (F-VMLSDT).
        currentBlocks.push(
          ...parseSdtContentBlocks(
            child,
            styleResolver,
            numberingResolver,
            imageResolver,
            hyperlinkResolver,
            this.paragraphParser,
            this.tableParser,
          ),
        );
      } else if (tag === 'sectpr') {
        // Final section properties for the body
        const { headers, footers } = parseSectionHeaderFooterReferences(child, headerFooterResolver);
        sections.push({
          type: 'section',
          properties: parseSectionProperties(child),
          children: currentBlocks,
          headers,
          footers,
        });
        currentBlocks = [];
      }
    }

    // If there were remaining blocks without an explicit sectPr
    if (currentBlocks.length > 0 || sections.length === 0) {
      sections.push({
        type: 'section',
        properties: parseSectionProperties(),
        children: currentBlocks,
      });
    }

    return {
      type: 'document',
      sections,
      metadata,
      footnotes,
      endnotes,
      comments,
      customStylesXml,
      customNumberingXml,
    };
  }

  parsePackage(pkg: OpcPackage): DocumentNode {
    const textDecoder = new TextDecoder();

    // 1. Resolve document part
    let docPartPath = 'word/document.xml';
    const rootRels = pkg.getRelationships();
    const docRel = rootRels.find((r) => r.type === KNOWN_RELATIONSHIPS.DOCUMENT);
    if (docRel) {
      docPartPath = docRel.target.replace(/^\/+/, '');
    }

    const docPart = pkg.getPart(docPartPath);
    if (!docPart) {
      throw new Error(`Main document part not found in package: ${docPartPath}`);
    }

    // 2. Resolve styles
    let styleResolver: StyleResolver | undefined;
    const docRels = pkg.getRelationships(docPartPath);
    const stylesRel = docRels.find((r) => r.type === KNOWN_RELATIONSHIPS.STYLES);
    const stylesPartPath = resolveWordPartPath(pkg, docPartPath, stylesRel?.target, 'word/styles.xml');
    const stylesPart = pkg.getPart(stylesPartPath);
    // Keep the raw source part verbatim: it round-trips back into the
    // written package so Word-authored definitions survive (F-STYLELOSS).
    // Style *resolution* still uses the parsed tree above.
    const customStylesXml = stylesPart ? textDecoder.decode(stylesPart.data) : undefined;
    if (stylesPart) {
      const stylesXml = parseWithMarkupCompatibility(customStylesXml!, (xml) => defaultXmlAdapter.parse(xml));
      const resolver = new StandardStyleResolver();
      resolver.loadStyles(stylesXml);
      styleResolver = resolver;
    }

    // 3. Resolve numbering
    let numberingResolver: NumberingResolver | undefined;
    const numRel = docRels.find((r) => r.type === KNOWN_RELATIONSHIPS.NUMBERING);
    const numPartPath = resolveWordPartPath(pkg, docPartPath, numRel?.target, 'word/numbering.xml');
    const numPart = pkg.getPart(numPartPath);
    const customNumberingXml = numPart ? textDecoder.decode(numPart.data) : undefined;
    if (numPart) {
      const numXml = parseWithMarkupCompatibility(customNumberingXml!, (xml) => defaultXmlAdapter.parse(xml));
      const resolver = new StandardNumberingResolver();
      resolver.parseNumberingXml(numXml);
      numberingResolver = resolver;
    }

    // 4. Resolve images. Relationship ids are scoped per part: a header,
    // footer, footnote, or comment part resolves its image rels against
    // its OWN .rels file, never the document's (F-HDRIMG). Sharing the
    // document map would both drop part-local images and risk matching
    // an unrelated same-id relationship from another part.
    const buildImageMap = (
      sourcePart: string,
      rels: OpcRelationship[],
    ): Map<string, { data?: Uint8Array; mimeType?: string; name?: string }> => {
      const map = new Map<string, { data?: Uint8Array; mimeType?: string; name?: string }>();
      for (const rel of rels) {
        if (rel.type === KNOWN_RELATIONSHIPS.IMAGE) {
          const imgPath = resolveRelTarget(pkg, sourcePart, rel.target);
          const imgPart = pkg.getPart(imgPath);
          if (imgPart) {
            map.set(rel.id, {
              data: imgPart.data,
              mimeType: imgPart.contentType,
              name: rel.target,
            });
          }
        }
      }
      return map;
    };
    const resolverFor = (
      map: Map<string, { data?: Uint8Array; mimeType?: string; name?: string }>,
    ): ImageResolver => ({
      resolveImage: (relId) => map.get(relId),
    });
    const imageResolver = resolverFor(buildImageMap(docPartPath, docRels));

    // Relationship ids are scoped per part: a header, footer, footnote,
    // endnote, or comment resolves its hyperlink rIds against its OWN
    // .rels file, never the document's (F-PLINK-PART). Sharing the
    // document map would resolve a part-local rId to an unrelated
    // same-id document URL.
    const hyperlinkResolverFor = (rels: OpcRelationship[]): HyperlinkResolver => {
      const map = new Map<string, string>();
      for (const rel of rels) {
        if (rel.type === KNOWN_RELATIONSHIPS.HYPERLINK && rel.target) {
          map.set(rel.id, rel.target);
        }
      }
      return { resolveHyperlink: (relId) => map.get(relId) };
    };

    // 5. Resolve headers and footers
    const headerMap = new Map<string, HeaderFooterNode>();
    const footerMap = new Map<string, HeaderFooterNode>();
    for (const rel of docRels) {
      if (rel.type === KNOWN_RELATIONSHIPS.HEADER) {
        const hPath = resolveRelTarget(pkg, docPartPath, rel.target);
        const hPart = pkg.getPart(hPath);
        if (hPart) {
          const hXml = parseWithMarkupCompatibility(textDecoder.decode(hPart.data), (xml) => defaultXmlAdapter.parse(xml));
          const hNode = parseHeaderFooterNode(hXml, 'default', styleResolver, numberingResolver, resolverFor(buildImageMap(hPath, pkg.getRelationships(hPath))), hyperlinkResolverFor(pkg.getRelationships(hPath)));
          headerMap.set(rel.id, hNode);
        }
      } else if (rel.type === KNOWN_RELATIONSHIPS.FOOTER) {
        const fPath = resolveRelTarget(pkg, docPartPath, rel.target);
        const fPart = pkg.getPart(fPath);
        if (fPart) {
          const fXml = parseWithMarkupCompatibility(textDecoder.decode(fPart.data), (xml) => defaultXmlAdapter.parse(xml));
          const fNode = parseHeaderFooterNode(fXml, 'default', styleResolver, numberingResolver, resolverFor(buildImageMap(fPath, pkg.getRelationships(fPath))), hyperlinkResolverFor(pkg.getRelationships(fPath)));
          footerMap.set(rel.id, fNode);
        }
      }
    }
    const headerFooterResolver: HeaderFooterResolver = {
      resolveHeader: (relId) => headerMap.get(relId),
      resolveFooter: (relId) => footerMap.get(relId),
    };

    // 6. Resolve hyperlinks (per-part helper defined in section 4).
    const hyperlinkResolver: HyperlinkResolver = hyperlinkResolverFor(docRels);

    // 7. Resolve footnotes & endnotes
    let footnotes: FootnoteNode[] | undefined;
    const fnRel = docRels.find((r) => r.type === KNOWN_RELATIONSHIPS.FOOTNOTES);
    const fnPath = resolveWordPartPath(pkg, docPartPath, fnRel?.target, 'word/footnotes.xml');
    const fnPart = pkg.getPart(fnPath);
    if (fnPart) {
      footnotes = parseFootnotesXml(
        textDecoder.decode(fnPart.data),
        styleResolver,
        numberingResolver,
        resolverFor(buildImageMap(fnPath, pkg.getRelationships(fnPath))),
        hyperlinkResolverFor(pkg.getRelationships(fnPath)),
      );
    }

    let endnotes: FootnoteNode[] | undefined;
    const enRel = docRels.find((r) => r.type === KNOWN_RELATIONSHIPS.ENDNOTES);
    const enPath = resolveWordPartPath(pkg, docPartPath, enRel?.target, 'word/endnotes.xml');
    const enPart = pkg.getPart(enPath);
    if (enPart) {
      endnotes = parseEndnotesXml(
        textDecoder.decode(enPart.data),
        styleResolver,
        numberingResolver,
        resolverFor(buildImageMap(enPath, pkg.getRelationships(enPath))),
        hyperlinkResolverFor(pkg.getRelationships(enPath)),
      );
    }

    // 8. Resolve comments
    let comments: CommentNode[] | undefined;
    const comRel = docRels.find((r) => r.type === KNOWN_RELATIONSHIPS.COMMENTS);
    const comPath = resolveWordPartPath(pkg, docPartPath, comRel?.target, 'word/comments.xml');
    const comPart = pkg.getPart(comPath);
    if (comPart) {
      comments = parseCommentsXml(
        textDecoder.decode(comPart.data),
        styleResolver,
        numberingResolver,
        resolverFor(buildImageMap(comPath, pkg.getRelationships(comPath))),
        hyperlinkResolverFor(pkg.getRelationships(comPath)),
      );
    }

    // 9. Resolve metadata
    const metadata = parsePackageMetadata(pkg);

    // 10. Document settings: w:evenAndOddHeaders is a document-wide switch
    // in word/settings.xml (ISO/IEC 29500-1 §17.15.1.35), not a sectPr
    // child; every section honors it (F-HDREVEN).
    const settingsRel = docRels.find((r) => r.type === KNOWN_RELATIONSHIPS.SETTINGS);
    const settingsPath = resolveWordPartPath(pkg, docPartPath, settingsRel?.target, 'word/settings.xml');
    const settingsPart = pkg.getPart(settingsPath);
    const evenAndOddHeaders = settingsPart
      ? parseEvenAndOddHeaders(parseWithMarkupCompatibility(textDecoder.decode(settingsPart.data), (xml) => defaultXmlAdapter.parse(xml)))
      : false;

    // 11. Parse document XML
    const rootNode = parseWithMarkupCompatibility(textDecoder.decode(docPart.data), (xml) => defaultXmlAdapter.parse(xml));
    const document = this.parseDocument(
      rootNode,
      styleResolver,
      numberingResolver,
      imageResolver,
      headerFooterResolver,
      hyperlinkResolver,
      metadata,
      footnotes,
      endnotes,
      comments,
      customStylesXml,
      customNumberingXml,
    );
    // Parsed packages carry the switch explicitly: false records "even
    // parts present but unused" so the layout ignores them like Word
    // does, while a hand-built AST (flag undefined) that supplies an
    // even header means to use it (F-HDREVEN).
    for (const section of document.sections) section.properties.evenAndOddHeaders = evenAndOddHeaders;
    return document;
  }
}

/** True when word/settings.xml turns on distinct even-page headers/footers. */
export function parseEvenAndOddHeaders(settingsRoot: XmlNode): boolean {
  const root = settingsRoot.nodeName.toLowerCase().endsWith('settings')
    ? settingsRoot
    : settingsRoot.children.find((c) => c.nodeName.toLowerCase().endsWith('settings'));
  if (!root) return false;
  for (const child of root.children) {
    const tag = child.nodeName.replace(/^[a-zA-Z0-9]+:/, '').toLowerCase();
    if (tag !== 'evenandoddheaders') continue;
    const val = (child.attributes['w:val'] ?? child.attributes['val'])?.toLowerCase();
    return val === undefined || !(val === '0' || val === 'false' || val === 'off');
  }
  return false;
}

export const defaultDocumentParser = new StandardDocumentParser();

/** Convenience top-level function to parse an OpcPackage into DocumentNode */
export function parsePackage(pkg: OpcPackage): DocumentNode {
  return defaultDocumentParser.parsePackage(pkg);
}

/** Convenience top-level function to open and parse a .docx Uint8Array buffer into DocumentNode */
export async function openDocument(
  data: Uint8Array,
  options?: { loadEmbeddedFonts?: boolean },
): Promise<DocumentNode> {
  const pkg = await openPackage(data);
  if (options?.loadEmbeddedFonts !== false) {
    // Register embedded fonts for exact text measurement (futures §5.2).
    // Failures are non-fatal by design — measurement falls back gracefully.
    loadEmbeddedFonts(pkg);
  }
  return defaultDocumentParser.parsePackage(pkg);
}
