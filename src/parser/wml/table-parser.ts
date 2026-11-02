import type { BlockNode, TableCellNode, TableNode, TableRowNode } from '../../types/ast.js';
import { twipsToPt } from '../../types/common.js';
import type { TableCellStyle, TableStyle } from '../../types/style.js';
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
    let style: TableStyle | undefined;
    let columnWidthsPt: number[] | undefined;
    const rows: TableRowNode[] = [];

    for (const child of node.children) {
      const tag = child.nodeName.replace(/^[a-zA-Z0-9]+:/, '').toLowerCase();
      if (tag === 'tblpr') {
        style = this.parseTableProperties(child);
      } else if (tag === 'tblgrid') {
        columnWidthsPt = this.parseTableGrid(child);
      } else if (tag === 'tr') {
        rows.push(this.parseRow(child, styleResolver, numberingResolver));
      }
    }

    this.resolveVerticalMerges(rows);

    return {
      type: 'table',
      style: style && Object.keys(style).length > 0 ? style : undefined,
      columnWidthsPt: columnWidthsPt && columnWidthsPt.length > 0 ? columnWidthsPt : undefined,
      rows,
    };
  }

  private parseTableProperties(node: XmlNode): TableStyle {
    const style: TableStyle = {};

    for (const child of node.children) {
      const tag = child.nodeName.replace(/^[a-zA-Z0-9]+:/, '').toLowerCase();

      if (tag === 'jc') {
        const val = (child.attributes['w:val'] ?? child.attributes['val'])?.toLowerCase();
        if (val === 'center' || val === 'right' || val === 'left') {
          style.alignment = val;
        }
      } else if (tag === 'tblw') {
        const type = (child.attributes['w:type'] ?? child.attributes['type'])?.toLowerCase();
        const wVal = Number(child.attributes['w:w'] ?? child.attributes['w']);
        if (!Number.isNaN(wVal)) {
          if (type === 'pct') {
            style.widthPercent = wVal / 50;
          } else if (type === 'dxa' || !type) {
            style.widthPt = twipsToPt(wVal);
          }
        }
      } else if (tag === 'tblborders') {
        for (const bChild of child.children) {
          const bTag = bChild.nodeName.replace(/^[a-zA-Z0-9]+:/, '').toLowerCase();
          const bVal = bChild.attributes['w:val'] ?? bChild.attributes['val'];
          const bColor = bChild.attributes['w:color'] ?? bChild.attributes['color'];
          const borderDef = bVal && bVal !== 'none' ? `${bVal} ${bColor ? '#' + bColor : '#000000'}` : 'none';

          if (bTag === 'top') style.borderTop = borderDef;
          else if (bTag === 'right') style.borderRight = borderDef;
          else if (bTag === 'bottom') style.borderBottom = borderDef;
          else if (bTag === 'left') style.borderLeft = borderDef;
          else if (bTag === 'insideh') style.borderInsideH = borderDef;
          else if (bTag === 'insidev') style.borderInsideV = borderDef;
        }
      } else if (tag === 'tblcellmar') {
        for (const mChild of child.children) {
          const mTag = mChild.nodeName.replace(/^[a-zA-Z0-9]+:/, '').toLowerCase();
          const wVal = Number(mChild.attributes['w:w'] ?? mChild.attributes['w']);
          if (!Number.isNaN(wVal)) {
            const pt = twipsToPt(wVal);
            if (mTag === 'top') style.cellMarginTopPt = pt;
            else if (mTag === 'right') style.cellMarginRightPt = pt;
            else if (mTag === 'bottom') style.cellMarginBottomPt = pt;
            else if (mTag === 'left') style.cellMarginLeftPt = pt;
          }
        }
      }
    }

    return style;
  }

  private parseTableGrid(node: XmlNode): number[] {
    const cols: number[] = [];
    for (const child of node.children) {
      const tag = child.nodeName.replace(/^[a-zA-Z0-9]+:/, '').toLowerCase();
      if (tag === 'gridcol') {
        const wVal = Number(child.attributes['w:w'] ?? child.attributes['w']);
        if (!Number.isNaN(wVal)) {
          cols.push(twipsToPt(wVal));
        }
      }
    }
    return cols;
  }

  private parseRow(node: XmlNode, styleResolver?: StyleResolver, numberingResolver?: NumberingResolver): TableRowNode {
    const cells: TableCellNode[] = [];
    let heightPt: number | undefined;
    let cantSplit: boolean | undefined;
    let tblHeader: boolean | undefined;

    for (const child of node.children) {
      const tag = child.nodeName.replace(/^[a-zA-Z0-9]+:/, '').toLowerCase();
      if (tag === 'trpr') {
        for (const trChild of child.children) {
          const trTag = trChild.nodeName.replace(/^[a-zA-Z0-9]+:/, '').toLowerCase();
          if (trTag === 'trheight') {
            const hVal = Number(trChild.attributes['w:val'] ?? trChild.attributes['val']);
            if (!Number.isNaN(hVal)) {
              heightPt = twipsToPt(hVal);
            }
          } else if (trTag === 'cantsplit') {
            cantSplit = true;
          } else if (trTag === 'tblheader') {
            tblHeader = true;
          }
        }
      } else if (tag === 'tc') {
        cells.push(this.parseCell(child, styleResolver, numberingResolver));
      }
    }

    return {
      type: 'table-row',
      heightPt,
      cantSplit,
      tblHeader,
      children: cells,
    };
  }

  private resolveVerticalMerges(rows: TableRowNode[]): void {
    const activeMerges: Map<number, TableCellNode> = new Map();

    for (const row of rows) {
      let colIndex = 0;

      for (const cell of row.children) {
        const span = cell.colSpan ?? 1;

        if (cell.vMerge === 'restart') {
          cell.rowSpan = 1;
          for (let s = 0; s < span; s++) {
            activeMerges.set(colIndex + s, cell);
          }
        } else if (cell.vMerge === 'continue') {
          const originCell = activeMerges.get(colIndex);
          if (originCell) {
            originCell.rowSpan = (originCell.rowSpan ?? 1) + 1;
            cell.rowSpan = 0;
          }
        } else {
          for (let s = 0; s < span; s++) {
            activeMerges.delete(colIndex + s);
          }
        }

        colIndex += span;
      }
    }
  }

  private parseCell(node: XmlNode, styleResolver?: StyleResolver, numberingResolver?: NumberingResolver): TableCellNode {
    let colSpan: number | undefined;
    let widthPt: number | undefined;
    let vMerge: 'restart' | 'continue' | undefined;
    let style: TableCellStyle | undefined;
    const children: BlockNode[] = [];

    for (const child of node.children) {
      const tag = child.nodeName.replace(/^[a-zA-Z0-9]+:/, '').toLowerCase();

      if (tag === 'tcpr') {
        const parsedPr = this.parseCellProperties(child);
        style = parsedPr.style;
        widthPt = parsedPr.widthPt;
        colSpan = parsedPr.colSpan;
        vMerge = parsedPr.vMerge;
      } else if (tag === 'p') {
        children.push(this.paragraphParser.parseParagraph(child, styleResolver, numberingResolver));
      } else if (tag === 'tbl') {
        children.push(this.parseTable(child, styleResolver, numberingResolver));
      }
    }

    return {
      type: 'table-cell',
      colSpan,
      rowSpan: vMerge === 'restart' ? 1 : vMerge === 'continue' ? 0 : undefined,
      vMerge,
      widthPt,
      style: style && Object.keys(style).length > 0 ? style : undefined,
      children,
    };
  }

  private parseCellProperties(node: XmlNode): {
    style: TableCellStyle;
    widthPt?: number;
    colSpan?: number;
    vMerge?: 'restart' | 'continue';
  } {
    const style: TableCellStyle = {};
    let widthPt: number | undefined;
    let colSpan: number | undefined;
    let vMerge: 'restart' | 'continue' | undefined;

    for (const child of node.children) {
      const tag = child.nodeName.replace(/^[a-zA-Z0-9]+:/, '').toLowerCase();

      if (tag === 'tcw') {
        const wVal = Number(child.attributes['w:w'] ?? child.attributes['w']);
        if (!Number.isNaN(wVal)) {
          widthPt = twipsToPt(wVal);
        }
      } else if (tag === 'gridspan') {
        const spanVal = Number(child.attributes['w:val'] ?? child.attributes['val']);
        if (!Number.isNaN(spanVal) && spanVal > 1) {
          colSpan = spanVal;
        }
      } else if (tag === 'vmerge') {
        const vVal = (child.attributes['w:val'] ?? child.attributes['val'])?.toLowerCase();
        vMerge = vVal === 'restart' ? 'restart' : 'continue';
      } else if (tag === 'valign') {
        const vVal = (child.attributes['w:val'] ?? child.attributes['val'])?.toLowerCase();
        if (vVal === 'top' || vVal === 'center' || vVal === 'bottom') {
          style.verticalAlign = vVal;
        }
      } else if (tag === 'shd') {
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
      } else if (tag === 'tcmar') {
        for (const mChild of child.children) {
          const mTag = mChild.nodeName.replace(/^[a-zA-Z0-9]+:/, '').toLowerCase();
          const wVal = Number(mChild.attributes['w:w'] ?? mChild.attributes['w']);
          if (!Number.isNaN(wVal)) {
            const pt = twipsToPt(wVal);
            if (mTag === 'top') style.paddingTopPt = pt;
            else if (mTag === 'right') style.paddingRightPt = pt;
            else if (mTag === 'bottom') style.paddingBottomPt = pt;
            else if (mTag === 'left') style.paddingLeftPt = pt;
          }
        }
      }
    }

    return { style, widthPt, colSpan, vMerge };
  }
}

export const defaultTableParser = new StandardTableParser();
