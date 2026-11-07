import type { BlockNode, TableCellNode, TableNode, TableRowNode } from '../../types/ast.js';
import { twipsToPt } from '../../types/common.js';
import type { TableCellStyle, TableStyle } from '../../types/style.js';
import type { XmlNode } from '../xml-adapter.js';
import type { NumberingResolver } from './numbering-resolver.js';
import { defaultParagraphParser, type ParagraphParser } from './paragraph-parser.js';
import { parseSdtContentBlocks } from './sdt-parser.js';
import { formatBorderDef, parseTablePropertiesNode } from './table-properties.js';
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
    let tableStyleId: string | undefined;
    let columnWidthsPt: number[] | undefined;
    const rows: TableRowNode[] = [];

    for (const child of node.children) {
      const tag = child.nodeName.replace(/^[a-zA-Z0-9]+:/, '').toLowerCase();
      if (tag === 'tblpr') {
        style = parseTablePropertiesNode(child);
        const styleRef = child.children.find((c) => c.nodeName.toLowerCase().endsWith('tblstyle'));
        tableStyleId = styleRef?.attributes['w:val'] ?? styleRef?.attributes['val'];
      } else if (tag === 'tblgrid') {
        columnWidthsPt = this.parseTableGrid(child);
      } else if (tag === 'tr') {
        rows.push(this.parseRow(child, styleResolver, numberingResolver));
      }
    }

    this.resolveVerticalMerges(rows);

    // Named table style (w:tblStyle) resolved through styles.xml. Direct
    // formatting in w:tblPr wins over the style definition (v2 N8).
    if (tableStyleId && styleResolver) {
      const resolved = styleResolver.resolveTableStyle(tableStyleId);
      if (Object.keys(resolved).length > 0) {
        style = { ...resolved, ...style };
      }
    }

    return {
      type: 'table',
      style: style && Object.keys(style).length > 0 ? style : undefined,
      columnWidthsPt: columnWidthsPt && columnWidthsPt.length > 0 ? columnWidthsPt : undefined,
      rows,
    };
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
            // A vertically merged region renders with the restart cell's
            // formatting across every covered row: continuation cells keep
            // their own style but inherit shading AND borders they lack
            // (v2 N4 remainder — borders previously did not propagate).
            const originStyle = originCell.style;
            if (originStyle && cell.style) {
              if (originStyle.backgroundColor && !cell.style.backgroundColor) {
                cell.style = { ...cell.style, backgroundColor: originStyle.backgroundColor };
              }
              for (const edge of ['borderTop', 'borderRight', 'borderBottom', 'borderLeft'] as const) {
                if (originStyle[edge] && !cell.style[edge]) {
                  cell.style = { ...cell.style, [edge]: originStyle[edge] };
                }
              }
            } else if (originStyle && !cell.style) {
              cell.style = { ...originStyle };
            }
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
        children.push(...(this.paragraphParser.drainPendingBlocks?.() ?? []));
      } else if (tag === 'tbl') {
        children.push(this.parseTable(child, styleResolver, numberingResolver));
      } else if (tag === 'sdt') {
        // Content controls unwrap to their authored blocks (F-VMLSDT).
        children.push(
          ...parseSdtContentBlocks(
            child,
            styleResolver,
            numberingResolver,
            undefined,
            undefined,
            this.paragraphParser,
            this,
          ),
        );
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
          const borderDef = formatBorderDef(bVal, bColor, borderChild.attributes['w:sz'] ?? borderChild.attributes['sz']);

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
