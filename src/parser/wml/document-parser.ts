import type {
  BlockNode,
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
import { openPackage, type OpcPackage } from '../../opc/package.js';
import { KNOWN_RELATIONSHIPS } from '../../opc/relationships.js';
import { parsePackageMetadata } from '../metadata/metadata-parser.js';
import { defaultXmlAdapter, type XmlNode } from '../xml-adapter.js';
import type { ImageResolver } from '../dml/image-parser.js';
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
      if (w) props.pageSize.width = twipsToPt(Number(w));
      if (h) props.pageSize.height = twipsToPt(Number(h));
    } else if (tag === 'pgmar') {
      const top = child.attributes['w:top'] ?? child.attributes['top'];
      const right = child.attributes['w:right'] ?? child.attributes['right'];
      const bottom = child.attributes['w:bottom'] ?? child.attributes['bottom'];
      const left = child.attributes['w:left'] ?? child.attributes['left'];
      const header = child.attributes['w:header'] ?? child.attributes['header'];
      const footer = child.attributes['w:footer'] ?? child.attributes['footer'];

      if (top) props.margins.top = twipsToPt(Number(top));
      if (right) props.margins.right = twipsToPt(Number(right));
      if (bottom) props.margins.bottom = twipsToPt(Number(bottom));
      if (left) props.margins.left = twipsToPt(Number(left));
      if (header) props.headerDistancePt = twipsToPt(Number(header));
      if (footer) props.footerDistancePt = twipsToPt(Number(footer));
    } else if (tag === 'titlepg') {
      props.titlePg = true;
    }
  }

  return props;
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
  ): DocumentNode {
    const rootNode = defaultXmlAdapter.parse(xmlString);
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
        currentBlocks.push(paragraph);

        // Check if paragraph contains section break in pPr
        const pPr = child.children.find((c) => c.nodeName.toLowerCase().endsWith('ppr'));
        const sectPr = pPr?.children.find((c) => c.nodeName.toLowerCase().endsWith('sectpr'));
        if (sectPr) {
          const { headers, footers } = parseSectionHeaderFooterReferences(sectPr, headerFooterResolver);
          sections.push({
            type: 'section',
            properties: parseSectionProperties(sectPr),
            children: currentBlocks,
            headers,
            footers,
          });
          currentBlocks = [];
        }
      } else if (tag === 'tbl') {
        const table = this.tableParser.parseTable(child, styleResolver, numberingResolver);
        currentBlocks.push(table);
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
    const stylesPartPath = stylesRel ? `word/${stylesRel.target.replace(/^\/+/, '')}` : 'word/styles.xml';
    const stylesPart = pkg.getPart(stylesPartPath);
    if (stylesPart) {
      const stylesXml = defaultXmlAdapter.parse(textDecoder.decode(stylesPart.data));
      const resolver = new StandardStyleResolver();
      resolver.loadStyles(stylesXml);
      styleResolver = resolver;
    }

    // 3. Resolve numbering
    let numberingResolver: NumberingResolver | undefined;
    const numRel = docRels.find((r) => r.type === KNOWN_RELATIONSHIPS.NUMBERING);
    const numPartPath = numRel ? `word/${numRel.target.replace(/^\/+/, '')}` : 'word/numbering.xml';
    const numPart = pkg.getPart(numPartPath);
    if (numPart) {
      const numXml = defaultXmlAdapter.parse(textDecoder.decode(numPart.data));
      const resolver = new StandardNumberingResolver();
      resolver.parseNumberingXml(numXml);
      numberingResolver = resolver;
    }

    // 4. Resolve images
    const imageMap = new Map<string, { data?: Uint8Array; mimeType?: string; name?: string }>();
    for (const rel of docRels) {
      if (rel.type === KNOWN_RELATIONSHIPS.IMAGE) {
        const imgPath = rel.target.startsWith('word/') ? rel.target : `word/${rel.target.replace(/^\/+/, '')}`;
        const imgPart = pkg.getPart(imgPath);
        if (imgPart) {
          imageMap.set(rel.id, {
            data: imgPart.data,
            mimeType: imgPart.contentType,
            name: rel.target,
          });
        }
      }
    }
    const imageResolver: ImageResolver = {
      resolveImage: (relId) => imageMap.get(relId),
    };

    // 5. Resolve headers and footers
    const headerMap = new Map<string, HeaderFooterNode>();
    const footerMap = new Map<string, HeaderFooterNode>();
    for (const rel of docRels) {
      if (rel.type === KNOWN_RELATIONSHIPS.HEADER) {
        const hPath = rel.target.startsWith('word/') ? rel.target : `word/${rel.target.replace(/^\/+/, '')}`;
        const hPart = pkg.getPart(hPath);
        if (hPart) {
          const hXml = defaultXmlAdapter.parse(textDecoder.decode(hPart.data));
          const hNode = parseHeaderFooterNode(hXml, 'default', styleResolver, numberingResolver, imageResolver);
          headerMap.set(rel.id, hNode);
        }
      } else if (rel.type === KNOWN_RELATIONSHIPS.FOOTER) {
        const fPath = rel.target.startsWith('word/') ? rel.target : `word/${rel.target.replace(/^\/+/, '')}`;
        const fPart = pkg.getPart(fPath);
        if (fPart) {
          const fXml = defaultXmlAdapter.parse(textDecoder.decode(fPart.data));
          const fNode = parseHeaderFooterNode(fXml, 'default', styleResolver, numberingResolver, imageResolver);
          footerMap.set(rel.id, fNode);
        }
      }
    }
    const headerFooterResolver: HeaderFooterResolver = {
      resolveHeader: (relId) => headerMap.get(relId),
      resolveFooter: (relId) => footerMap.get(relId),
    };

    // 6. Resolve hyperlinks
    const hyperlinkMap = new Map<string, string>();
    for (const rel of docRels) {
      if (rel.type === KNOWN_RELATIONSHIPS.HYPERLINK && rel.target) {
        hyperlinkMap.set(rel.id, rel.target);
      }
    }
    const hyperlinkResolver: HyperlinkResolver = {
      resolveHyperlink: (relId) => hyperlinkMap.get(relId),
    };

    // 7. Resolve footnotes & endnotes
    let footnotes: FootnoteNode[] | undefined;
    const fnRel = docRels.find((r) => r.type === KNOWN_RELATIONSHIPS.FOOTNOTES);
    const fnPath = fnRel ? `word/${fnRel.target.replace(/^\/+/, '')}` : 'word/footnotes.xml';
    const fnPart = pkg.getPart(fnPath);
    if (fnPart) {
      footnotes = parseFootnotesXml(
        textDecoder.decode(fnPart.data),
        styleResolver,
        numberingResolver,
        imageResolver,
        hyperlinkResolver,
      );
    }

    let endnotes: FootnoteNode[] | undefined;
    const enRel = docRels.find((r) => r.type === KNOWN_RELATIONSHIPS.ENDNOTES);
    const enPath = enRel ? `word/${enRel.target.replace(/^\/+/, '')}` : 'word/endnotes.xml';
    const enPart = pkg.getPart(enPath);
    if (enPart) {
      endnotes = parseEndnotesXml(
        textDecoder.decode(enPart.data),
        styleResolver,
        numberingResolver,
        imageResolver,
        hyperlinkResolver,
      );
    }

    // 8. Resolve metadata
    const metadata = parsePackageMetadata(pkg);

    // 9. Parse document XML
    const rootNode = defaultXmlAdapter.parse(textDecoder.decode(docPart.data));
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
    );
  }
}

export const defaultDocumentParser = new StandardDocumentParser();

/** Convenience top-level function to parse an OpcPackage into DocumentNode */
export function parsePackage(pkg: OpcPackage): DocumentNode {
  return defaultDocumentParser.parsePackage(pkg);
}

/** Convenience top-level function to open and parse a .docx Uint8Array buffer into DocumentNode */
export async function openDocument(data: Uint8Array): Promise<DocumentNode> {
  const pkg = await openPackage(data);
  return defaultDocumentParser.parsePackage(pkg);
}
