import { twipsToPt } from '../../types/common.js';
import type { TableStyle } from '../../types/style.js';
import type { XmlNode } from '../xml-adapter.js';

/**
 * Shared table-property parsing. Lives in its own module so that both the
 * table parser and the style resolver can use it without creating an import
 * cycle between them (style-resolver ← paragraph-parser ← table-parser).
 */

/**
 * Builds a borderDef string ("style color [widthPt]"). The optional trailing
 * width keeps the OOXML border size (w:sz, in eighths of a point) lossy-free:
 * parseBorderStyle consumes the pt token so layout, HTML, and the serializer
 * can all recover the authored thickness (v1 F10).
 */
export function formatBorderDef(styleVal: string | undefined, color: string | undefined, sz: string | undefined): string {
  if (!styleVal || styleVal === 'none') return 'none';
  let def = `${styleVal} ${color ? '#' + color : '#000000'}`;
  const szNum = Number(sz);
  if (sz !== undefined && !Number.isNaN(szNum) && szNum > 0) {
    def += ` ${szNum / 8}pt`;
  }
  return def;
}

/**
 * Parses a w:tblPr element into a TableStyle. Shared with the style resolver,
 * which must parse the w:tblPr embedded in a w:style definition (v2 N8).
 */
export function parseTablePropertiesNode(node: XmlNode): TableStyle {
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
        const borderDef = formatBorderDef(bVal, bColor, bChild.attributes['w:sz'] ?? bChild.attributes['sz']);

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
