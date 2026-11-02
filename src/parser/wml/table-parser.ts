import type { BlockNode, TableCellNode, TableNode, TableRowNode } from '../../types/ast.js';
import type { TableCellStyle } from '../../types/style.js';
import type { XmlNode } from '../xml-adapter.js';
import type { NumberingResolver } from './numbering-resolver.js';
import { defaultParagraphParser, type ParagraphParser } from './paragraph-parser.js';
import type { StyleResolver } from './style-resolver.js';

/**
 * Parser for w:tbl (tables), w:tr (rows), and w:tc (cells).
 */

export interface TableParser {
  parseTable(node: XmlNode, styleResolver?: StyleResolver, numberingResolver?: NumberingResolver): TableNode;
}

export class StandardTableParser implements TableParser {
  private paragraphParser: ParagraphParser;

  constructor(paragraphParser: ParagraphParser = defaultParagraphParser) {
    this.paragraphParser = paragraphParser;
  }

  parseTable(node: XmlNode, styleResolver?: StyleResolver, numberingResolver?: NumberingResolver): TableNode {
    const rows: TableRowNode[] = [];

    for (const child of node.children) {
      const tag = child.nodeName.replace(/^[a-zA-Z0-9]+:/, '').toLowerCase();
      if (tag === 'tr') {
        rows.push(this.parseRow(child, styleResolver, numberingResolver));
      }
    }

    return {
      type: 'table',
      rows,
    };
  }

  private parseRow(node: XmlNode, styleResolver?: StyleResolver, numberingResolver?: NumberingResolver): TableRowNode {
    const cells: TableCellNode[] = [];

    for (const child of node.children) {
      const tag = child.nodeName.replace(/^[a-zA-Z0-9]+:/, '').toLowerCase();
      if (tag === 'tc') {
        cells.push(this.parseCell(child, styleResolver, numberingResolver));
      }
    }

    return {
      type: 'table-row',
      children: cells,
    };
  }

  private parseCell(node: XmlNode, styleResolver?: StyleResolver, numberingResolver?: NumberingResolver): TableCellNode {
    let colSpan: number | undefined;
    let style: TableCellStyle | undefined;
    const children: BlockNode[] = [];

    for (const child of node.children) {
      const tag = child.nodeName.replace(/^[a-zA-Z0-9]+:/, '').toLowerCase();

      if (tag === 'tcpr') {
        style = this.parseCellProperties(child);
        const gridSpan = child.children.find((c) => c.nodeName.toLowerCase().endsWith('gridspan'));
        if (gridSpan) {
          const spanVal = Number(gridSpan.attributes['w:val'] ?? gridSpan.attributes['val']);
          if (!Number.isNaN(spanVal) && spanVal > 1) {
            colSpan = spanVal;
          }
        }
      } else if (tag === 'p') {
        children.push(this.paragraphParser.parseParagraph(child, styleResolver, numberingResolver));
      } else if (tag === 'tbl') {
        children.push(this.parseTable(child, styleResolver, numberingResolver));
      }
    }

    return {
      type: 'table-cell',
      colSpan,
      style: style && Object.keys(style).length > 0 ? style : undefined,
      children,
    };
  }

  private parseCellProperties(node: XmlNode): TableCellStyle {
    const style: TableCellStyle = {};

    for (const child of node.children) {
      const tag = child.nodeName.replace(/^[a-zA-Z0-9]+:/, '').toLowerCase();

      if (tag === 'shd') {
        const fill = child.attributes['w:fill'] ?? child.attributes['fill'];
        if (fill && fill !== 'auto' && fill !== 'none') {
          style.backgroundColor = fill.startsWith('#') ? fill : '#' + fill;
        }
      } else if (tag === 'tcborders') {
        for (const borderChild of child.children) {
          const bTag = borderChild.nodeName.replace(/^[a-zA-Z0-9]+:/, '').toLowerCase();
          const bVal = borderChild.attributes['w:val'] ?? borderChild.attributes['val'];
          const bColor = borderChild.attributes['w:color'] ?? borderChild.attributes['color'];
          const borderDef = bVal && bVal !== 'none' ? `${bVal} ${bColor ? '#' + bColor : '#000000'}` : 'none';

          if (bTag === 'top') style.borderTop = borderDef;
          else if (bTag === 'right') style.borderRight = borderDef;
          else if (bTag === 'bottom') style.borderBottom = borderDef;
          else if (bTag === 'left') style.borderLeft = borderDef;
        }
      }
    }

    return style;
  }
}

export const defaultTableParser = new StandardTableParser();
