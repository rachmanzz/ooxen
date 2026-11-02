import type { BlockNode, FootnoteNode } from '../../types/ast.js';
import type { ImageResolver } from '../dml/image-parser.js';
import { defaultXmlAdapter, type XmlAdapter, type XmlNode } from '../xml-adapter.js';
import type { NumberingResolver } from './numbering-resolver.js';
import { defaultParagraphParser, type HyperlinkResolver, type ParagraphParser } from './paragraph-parser.js';
import type { StyleResolver } from './style-resolver.js';
import { defaultTableParser, type TableParser } from './table-parser.js';

/**
 * Footnote and Endnote resolver interface.
 */
export interface FootnoteResolver {
  resolveFootnote(id: number): FootnoteNode | undefined;
  resolveEndnote(id: number): FootnoteNode | undefined;
}

export class MapFootnoteResolver implements FootnoteResolver {
  private footnotes = new Map<number, FootnoteNode>();
  private endnotes = new Map<number, FootnoteNode>();

  registerFootnote(node: FootnoteNode): void {
    this.footnotes.set(node.id, node);
  }

  registerEndnote(node: FootnoteNode): void {
    this.endnotes.set(node.id, node);
  }

  resolveFootnote(id: number): FootnoteNode | undefined {
    return this.footnotes.get(id);
  }

  resolveEndnote(id: number): FootnoteNode | undefined {
    return this.endnotes.get(id);
  }
}

/**
 * Parses word/footnotes.xml into an array of FootnoteNode.
 */
export function parseFootnotesNode(
  rootNode: XmlNode,
  styleResolver?: StyleResolver,
  numberingResolver?: NumberingResolver,
  imageResolver?: ImageResolver,
  hyperlinkResolver?: HyperlinkResolver,
  paragraphParser: ParagraphParser = defaultParagraphParser,
  tableParser: TableParser = defaultTableParser,
): FootnoteNode[] {
  const result: FootnoteNode[] = [];

  for (const child of rootNode.children) {
    const tag = child.nodeName.replace(/^[a-zA-Z0-9]+:/, '').toLowerCase();
    if (tag === 'footnote') {
      const idStr = child.attributes['w:id'] ?? child.attributes['id'];
      if (idStr === undefined) continue;
      const id = Number(idStr);
      const typeCategory = (child.attributes['w:type'] ?? child.attributes['type'] ?? 'normal') as
        | 'normal'
        | 'separator'
        | 'continuationSeparator';

      const blocks: BlockNode[] = [];
      for (const bChild of child.children) {
        const bTag = bChild.nodeName.replace(/^[a-zA-Z0-9]+:/, '').toLowerCase();
        if (bTag === 'p') {
          blocks.push(
            paragraphParser.parseParagraph(bChild, styleResolver, numberingResolver, imageResolver, hyperlinkResolver),
          );
        } else if (bTag === 'tbl') {
          blocks.push(tableParser.parseTable(bChild, styleResolver, numberingResolver));
        }
      }

      result.push({
        type: 'footnote',
        kind: 'footnote',
        id,
        typeCategory,
        children: blocks,
      });
    }
  }

  return result;
}

export function parseFootnotesXml(
  xmlString: string,
  styleResolver?: StyleResolver,
  numberingResolver?: NumberingResolver,
  imageResolver?: ImageResolver,
  hyperlinkResolver?: HyperlinkResolver,
  paragraphParser: ParagraphParser = defaultParagraphParser,
  tableParser: TableParser = defaultTableParser,
  xmlAdapter: XmlAdapter = defaultXmlAdapter,
): FootnoteNode[] {
  const rootNode = xmlAdapter.parse(xmlString);
  return parseFootnotesNode(
    rootNode,
    styleResolver,
    numberingResolver,
    imageResolver,
    hyperlinkResolver,
    paragraphParser,
    tableParser,
  );
}

/**
 * Parses word/endnotes.xml into an array of FootnoteNode.
 */
export function parseEndnotesNode(
  rootNode: XmlNode,
  styleResolver?: StyleResolver,
  numberingResolver?: NumberingResolver,
  imageResolver?: ImageResolver,
  hyperlinkResolver?: HyperlinkResolver,
  paragraphParser: ParagraphParser = defaultParagraphParser,
  tableParser: TableParser = defaultTableParser,
): FootnoteNode[] {
  const result: FootnoteNode[] = [];

  for (const child of rootNode.children) {
    const tag = child.nodeName.replace(/^[a-zA-Z0-9]+:/, '').toLowerCase();
    if (tag === 'endnote') {
      const idStr = child.attributes['w:id'] ?? child.attributes['id'];
      if (idStr === undefined) continue;
      const id = Number(idStr);
      const typeCategory = (child.attributes['w:type'] ?? child.attributes['type'] ?? 'normal') as
        | 'normal'
        | 'separator'
        | 'continuationSeparator';

      const blocks: BlockNode[] = [];
      for (const bChild of child.children) {
        const bTag = bChild.nodeName.replace(/^[a-zA-Z0-9]+:/, '').toLowerCase();
        if (bTag === 'p') {
          blocks.push(
            paragraphParser.parseParagraph(bChild, styleResolver, numberingResolver, imageResolver, hyperlinkResolver),
          );
        } else if (bTag === 'tbl') {
          blocks.push(tableParser.parseTable(bChild, styleResolver, numberingResolver));
        }
      }

      result.push({
        type: 'endnote',
        kind: 'endnote',
        id,
        typeCategory,
        children: blocks,
      });
    }
  }

  return result;
}

export function parseEndnotesXml(
  xmlString: string,
  styleResolver?: StyleResolver,
  numberingResolver?: NumberingResolver,
  imageResolver?: ImageResolver,
  hyperlinkResolver?: HyperlinkResolver,
  paragraphParser: ParagraphParser = defaultParagraphParser,
  tableParser: TableParser = defaultTableParser,
  xmlAdapter: XmlAdapter = defaultXmlAdapter,
): FootnoteNode[] {
  const rootNode = xmlAdapter.parse(xmlString);
  return parseEndnotesNode(
    rootNode,
    styleResolver,
    numberingResolver,
    imageResolver,
    hyperlinkResolver,
    paragraphParser,
    tableParser,
  );
}
