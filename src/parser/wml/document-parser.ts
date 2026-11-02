import type { BlockNode, DocumentNode, SectionNode, SectionProperties } from '../../types/ast.js';
import { twipsToPt } from '../../types/common.js';
import type { XmlNode } from '../xml-adapter.js';
import { defaultParagraphParser, type ParagraphParser } from './paragraph-parser.js';
import type { StyleResolver } from './style-resolver.js';
import { defaultTableParser, type TableParser } from './table-parser.js';

/**
 * Top-level WordprocessingML document parser (w:document & w:body) according to ISO/IEC 29500-1.
 */

export interface DocumentParser {
  parseDocument(rootNode: XmlNode, styleResolver?: StyleResolver): DocumentNode;
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

      if (top) props.margins.top = twipsToPt(Number(top));
      if (right) props.margins.right = twipsToPt(Number(right));
      if (bottom) props.margins.bottom = twipsToPt(Number(bottom));
      if (left) props.margins.left = twipsToPt(Number(left));
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

  parseDocument(rootNode: XmlNode, styleResolver?: StyleResolver): DocumentNode {
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
      };
    }

    const sections: SectionNode[] = [];
    let currentBlocks: BlockNode[] = [];

    for (const child of bodyNode.children) {
      const tag = child.nodeName.replace(/^[a-zA-Z0-9]+:/, '').toLowerCase();

      if (tag === 'p') {
        const paragraph = this.paragraphParser.parseParagraph(child, styleResolver);
        currentBlocks.push(paragraph);

        // Check if paragraph contains section break in pPr
        const pPr = child.children.find((c) => c.nodeName.toLowerCase().endsWith('ppr'));
        const sectPr = pPr?.children.find((c) => c.nodeName.toLowerCase().endsWith('sectpr'));
        if (sectPr) {
          sections.push({
            type: 'section',
            properties: parseSectionProperties(sectPr),
            children: currentBlocks,
          });
          currentBlocks = [];
        }
      } else if (tag === 'tbl') {
        const table = this.tableParser.parseTable(child, styleResolver);
        currentBlocks.push(table);
      } else if (tag === 'sectpr') {
        // Final section properties for the body
        sections.push({
          type: 'section',
          properties: parseSectionProperties(child),
          children: currentBlocks,
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
    };
  }
}

export const defaultDocumentParser = new StandardDocumentParser();
