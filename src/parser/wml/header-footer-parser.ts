import type { BlockNode, HeaderFooterNode, HeaderFooterType } from '../../types/ast.js';
import type { ImageResolver } from '../dml/image-parser.js';
import { defaultXmlAdapter, type XmlAdapter, type XmlNode } from '../xml-adapter.js';
import type { NumberingResolver } from './numbering-resolver.js';
import { defaultParagraphParser, type ParagraphParser } from './paragraph-parser.js';
import type { StyleResolver } from './style-resolver.js';
import { defaultTableParser, type TableParser } from './table-parser.js';

/**
 * ISO/IEC 29500-1 WordprocessingML Header and Footer parser (w:hdr and w:ftr).
 */

export interface HeaderFooterResolver {
  resolveHeader(relationshipId: string): HeaderFooterNode | undefined;
  resolveFooter(relationshipId: string): HeaderFooterNode | undefined;
}

export class MapHeaderFooterResolver implements HeaderFooterResolver {
  private headers = new Map<string, HeaderFooterNode>();
  private footers = new Map<string, HeaderFooterNode>();

  registerHeader(relationshipId: string, node: HeaderFooterNode): void {
    this.headers.set(relationshipId, node);
  }

  registerFooter(relationshipId: string, node: HeaderFooterNode): void {
    this.footers.set(relationshipId, node);
  }

  resolveHeader(relationshipId: string): HeaderFooterNode | undefined {
    return this.headers.get(relationshipId);
  }

  resolveFooter(relationshipId: string): HeaderFooterNode | undefined {
    return this.footers.get(relationshipId);
  }
}

export function parseHeaderFooterNode(
  rootNode: XmlNode,
  kind: HeaderFooterType = 'default',
  styleResolver?: StyleResolver,
  numberingResolver?: NumberingResolver,
  imageResolver?: ImageResolver,
  paragraphParser: ParagraphParser = defaultParagraphParser,
  tableParser: TableParser = defaultTableParser,
): HeaderFooterNode {
  const tagName = rootNode.nodeName.replace(/^[a-zA-Z0-9]+:/, '').toLowerCase();
  const type: 'header' | 'footer' = tagName === 'ftr' ? 'footer' : 'header';

  const children: BlockNode[] = [];

  for (const child of rootNode.children) {
    const tag = child.nodeName.replace(/^[a-zA-Z0-9]+:/, '').toLowerCase();

    if (tag === 'p') {
      const paragraph = paragraphParser.parseParagraph(child, styleResolver, numberingResolver, imageResolver);
      children.push(paragraph);
    } else if (tag === 'tbl') {
      const table = tableParser.parseTable(child, styleResolver, numberingResolver);
      children.push(table);
    }
  }

  return {
    type,
    kind,
    children,
  };
}

export function parseHeaderFooterXml(
  xmlString: string,
  kind: HeaderFooterType = 'default',
  styleResolver?: StyleResolver,
  numberingResolver?: NumberingResolver,
  imageResolver?: ImageResolver,
  paragraphParser: ParagraphParser = defaultParagraphParser,
  tableParser: TableParser = defaultTableParser,
  xmlAdapter: XmlAdapter = defaultXmlAdapter,
): HeaderFooterNode {
  const rootNode = xmlAdapter.parse(xmlString);
  return parseHeaderFooterNode(
    rootNode,
    kind,
    styleResolver,
    numberingResolver,
    imageResolver,
    paragraphParser,
    tableParser,
  );
}
