import { twipsToPt } from '../../types/common.js';
import type { ParagraphStyle, TableStyle, TabLeader, TabStop, TabStopAlignment, TextStyle } from '../../types/style.js';
import { parseTablePropertiesNode } from './table-properties.js';
import type { XmlNode } from '../xml-adapter.js';

/**
 * Resolves cascading styles from word/styles.xml according to ISO/IEC 29500-1.
 */

export interface StyleDefinition {
  id: string;
  type: 'paragraph' | 'character' | 'table' | 'numbering';
  name?: string;
  basedOn?: string;
  isDefault?: boolean;
  paragraphStyle?: ParagraphStyle;
  textStyle?: TextStyle;
  tableStyle?: TableStyle;
}

export function parseRunProperties(node?: XmlNode): TextStyle {
  if (!node) return {};
  const style: TextStyle = {};

  for (const child of node.children) {
    const tag = child.nodeName.replace(/^[a-zA-Z0-9]+:/, '').toLowerCase();
    const val = child.attributes['w:val'] ?? child.attributes['val'];

    switch (tag) {
      case 'rfonts': {
        const font = child.attributes['w:ascii'] ?? child.attributes['ascii'] ?? val;
        if (font) style.fontFamily = font;
        break;
      }
      case 'b':
        style.bold = val === undefined || val === '1' || val === 'true';
        break;
      case 'i':
        style.italic = val === undefined || val === '1' || val === 'true';
        break;
      case 'u':
        style.underline = val !== 'none' && val !== '0' && val !== 'false';
        break;
      case 'strike':
        style.strike = val === undefined || val === '1' || val === 'true';
        break;
      case 'sz': {
        const halfPt = Number(val);
        if (!Number.isNaN(halfPt) && halfPt > 0) {
          style.fontSizePt = halfPt / 2;
        }
        break;
      }
      case 'color': {
        if (val && val !== 'auto') {
          style.color = val.startsWith('#') ? val : '#' + val;
        }
        break;
      }
      case 'shd': {
        const fill = child.attributes['w:fill'] ?? child.attributes['fill'];
        if (fill && fill !== 'auto' && fill !== 'none') {
          style.backgroundColor = fill.startsWith('#') ? fill : '#' + fill;
        }
        break;
      }
      case 'highlight': {
        if (val && val !== 'none') {
          style.backgroundColor = val;
        }
        break;
      }
      case 'vertalign': {
        if (val === 'superscript' || val === 'subscript' || val === 'baseline') {
          style.verticalAlign = val;
        }
        break;
      }
    }
  }

  return style;
}

export function parseParagraphProperties(node?: XmlNode): ParagraphStyle {
  if (!node) return {};
  const style: ParagraphStyle = {};

  for (const child of node.children) {
    const tag = child.nodeName.replace(/^[a-zA-Z0-9]+:/, '').toLowerCase();
    const val = child.attributes['w:val'] ?? child.attributes['val'];

    switch (tag) {
      case 'jc': {
        if (val === 'left' || val === 'start') style.alignment = 'left';
        else if (val === 'center') style.alignment = 'center';
        else if (val === 'right' || val === 'end') style.alignment = 'right';
        else if (val === 'both' || val === 'distribute') style.alignment = 'justify';
        break;
      }
      case 'spacing': {
        const before = child.attributes['w:before'] ?? child.attributes['before'];
        const after = child.attributes['w:after'] ?? child.attributes['after'];
        const line = child.attributes['w:line'] ?? child.attributes['line'];
        const lineRule = (
          child.attributes['w:lineRule'] ?? child.attributes['lineRule'] ?? child.attributes['w:linerule'] ?? child.attributes['linerule'] ?? 'auto'
        ).toLowerCase();

        if (before) style.spaceBeforePt = twipsToPt(Number(before));
        if (after) style.spaceAfterPt = twipsToPt(Number(after));
        if (line) {
          const lineVal = Number(line);
          if (lineRule === 'exact' || lineRule === 'atLeast' || lineRule === 'atMost') {
            // With an explicit rule, w:line is in twips.
            style.lineSpacingPt = twipsToPt(lineVal);
          } else {
            // lineRule="auto" (the default): w:line is in 240ths of a line
            // (v2 N9). The AST stores an absolute height, so approximate one
            // single line as ~1.2 × the default 11pt body font (≈13.2pt).
            style.lineSpacingPt = (lineVal / 240) * 13.2;
          }
        }
        break;
      }
      case 'ind': {
        const left = child.attributes['w:left'] ?? child.attributes['left'];
        const right = child.attributes['w:right'] ?? child.attributes['right'];
        const firstLine = child.attributes['w:firstline'] ?? child.attributes['firstLine'];
        const hanging = child.attributes['w:hanging'] ?? child.attributes['hanging'];

        if (left) style.indentLeftPt = twipsToPt(Number(left));
        if (right) style.indentRightPt = twipsToPt(Number(right));
        if (firstLine) style.firstLineIndentPt = twipsToPt(Number(firstLine));
        else if (hanging) style.firstLineIndentPt = -twipsToPt(Number(hanging));
        break;
      }
      case 'numpr': {
        const ilvlNode = child.children.find((c) => c.nodeName.toLowerCase().endsWith('ilvl'));
        const numIdNode = child.children.find((c) => c.nodeName.toLowerCase().endsWith('numid'));
        const ilvl = Number.parseInt(ilvlNode?.attributes['w:val'] ?? ilvlNode?.attributes['val'] ?? '0', 10);
        const numId = Number.parseInt(numIdNode?.attributes['w:val'] ?? numIdNode?.attributes['val'] ?? '0', 10);
        style.numbering = { numId, level: ilvl };
        break;
      }
      case 'pagebreakbefore': {
        style.pageBreakBefore = val === undefined || val === 'true' || val === '1' || val === 'on';
        break;
      }
      case 'keepnext': {
        style.keepNext = val === undefined || val === 'true' || val === '1' || val === 'on';
        break;
      }
      case 'keeplines': {
        style.keepLines = val === undefined || val === 'true' || val === '1' || val === 'on';
        break;
      }
      case 'tabs': {
        const tabStops: TabStop[] = [];
        for (const tabChild of child.children) {
          const tabTag = tabChild.nodeName.replace(/^[a-zA-Z0-9]+:/, '').toLowerCase();
          if (tabTag === 'tab') {
            const tabVal = (tabChild.attributes['w:val'] ?? tabChild.attributes['val'] ?? 'left').toLowerCase();
            const tabPos = tabChild.attributes['w:pos'] ?? tabChild.attributes['pos'];
            const tabLeader = (tabChild.attributes['w:leader'] ?? tabChild.attributes['leader'] ?? 'none').toLowerCase();
            if (tabPos) {
              tabStops.push({
                positionPt: twipsToPt(Number(tabPos)),
                alignment: (['left', 'center', 'right', 'decimal', 'bar', 'clear'].includes(tabVal)
                  ? tabVal
                  : 'left') as TabStopAlignment,
                leader: (['none', 'dot', 'hyphen', 'underscore', 'heavy', 'middleDot'].includes(tabLeader)
                  ? tabLeader
                  : 'none') as TabLeader,
              });
            }
          }
        }
        if (tabStops.length > 0) {
          style.tabStops = tabStops;
        }
        break;
      }
    }
  }

  return style;
}

export interface StyleResolver {
  loadStyles(stylesXmlNode: XmlNode): void;
  resolveParagraphStyle(styleId?: string): ParagraphStyle;
  resolveRunStyle(styleId?: string): TextStyle;
  resolveTableStyle(styleId?: string): TableStyle;
  getDefaultRunStyle(): TextStyle;
  getDefaultParagraphStyle(): ParagraphStyle;
}

export class StandardStyleResolver implements StyleResolver {
  private styles = new Map<string, StyleDefinition>();
  private defaultRunStyle: TextStyle = {
    fontFamily: 'Calibri',
    fontSizePt: 11,
    color: '#000000',
  };
  private defaultParagraphStyle: ParagraphStyle = {
    alignment: 'left',
  };

  loadStyles(stylesXmlNode: XmlNode): void {
    this.styles.clear();

    for (const child of stylesXmlNode.children) {
      const tag = child.nodeName.replace(/^[a-zA-Z0-9]+:/, '').toLowerCase();

      if (tag === 'docdefaults') {
        this.parseDocDefaults(child);
      } else if (tag === 'style') {
        this.parseStyleNode(child);
      }
    }
  }

  private parseDocDefaults(node: XmlNode): void {
    for (const child of node.children) {
      const tag = child.nodeName.replace(/^[a-zA-Z0-9]+:/, '').toLowerCase();
      if (tag === 'rprdefault') {
        const rPr = child.children.find((c) => c.nodeName.endsWith('rPr') || c.nodeName === 'rPr');
        if (rPr) {
          this.defaultRunStyle = { ...this.defaultRunStyle, ...parseRunProperties(rPr) };
        }
      } else if (tag === 'pprdefault') {
        const pPr = child.children.find((c) => c.nodeName.endsWith('pPr') || c.nodeName === 'pPr');
        if (pPr) {
          this.defaultParagraphStyle = { ...this.defaultParagraphStyle, ...parseParagraphProperties(pPr) };
        }
      }
    }
  }

  private parseStyleNode(node: XmlNode): void {
    const id = node.attributes['w:styleId'] ?? node.attributes['styleId'];
    const type = (node.attributes['w:type'] ?? node.attributes['type'] ?? 'paragraph') as StyleDefinition['type'];
    const isDefault = node.attributes['w:default'] === '1' || node.attributes['default'] === '1';

    if (!id) return;

    let basedOn: string | undefined;
    let name: string | undefined;
    let paragraphStyle: ParagraphStyle | undefined;
    let textStyle: TextStyle | undefined;
    let tableStyle: TableStyle | undefined;

    for (const child of node.children) {
      const tag = child.nodeName.replace(/^[a-zA-Z0-9]+:/, '').toLowerCase();
      const val = child.attributes['w:val'] ?? child.attributes['val'];

      if (tag === 'basedon') {
        basedOn = val;
      } else if (tag === 'name') {
        name = val;
      } else if (tag === 'ppr') {
        paragraphStyle = parseParagraphProperties(child);
      } else if (tag === 'rpr') {
        textStyle = parseRunProperties(child);
      } else if (tag === 'tblpr') {
        // Table style definitions embed their properties in w:tblPr —
        // borders, cell margins, width, alignment (v2 N8).
        tableStyle = parseTablePropertiesNode(child);
      }
    }

    const def: StyleDefinition = {
      id,
      type,
      name,
      basedOn,
      isDefault,
      paragraphStyle,
      textStyle,
      tableStyle,
    };

    this.styles.set(id, def);
  }

  getDefaultRunStyle(): TextStyle {
    return { ...this.defaultRunStyle };
  }

  getDefaultParagraphStyle(): ParagraphStyle {
    return { ...this.defaultParagraphStyle };
  }

  resolveParagraphStyle(styleId?: string): ParagraphStyle {
    let result: ParagraphStyle = { ...this.defaultParagraphStyle };
    if (!styleId) return result;

    const chain: StyleDefinition[] = [];
    let current = this.styles.get(styleId);
    const visited = new Set<string>();

    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      chain.unshift(current); // Base styles first
      current = current.basedOn ? this.styles.get(current.basedOn) : undefined;
    }

    for (const def of chain) {
      if (def.paragraphStyle) {
        result = { ...result, ...def.paragraphStyle };
      }
    }

    return result;
  }

  resolveRunStyle(styleId?: string): TextStyle {
    let result: TextStyle = { ...this.defaultRunStyle };
    if (!styleId) return result;

    const chain: StyleDefinition[] = [];
    let current = this.styles.get(styleId);
    const visited = new Set<string>();

    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      chain.unshift(current);
      current = current.basedOn ? this.styles.get(current.basedOn) : undefined;
    }

    for (const def of chain) {
      if (def.textStyle) {
        result = { ...result, ...def.textStyle };
      }
    }

    return result;
  }

  resolveTableStyle(styleId?: string): TableStyle {
    // Unlike paragraph/run styles, table styles have no docDefaults seed:
    // an absent style resolves to an empty (untouched) table.
    if (!styleId) return {};

    const chain: StyleDefinition[] = [];
    let current = this.styles.get(styleId);
    const visited = new Set<string>();

    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      chain.unshift(current);
      current = current.basedOn ? this.styles.get(current.basedOn) : undefined;
    }

    let result: TableStyle = {};
    for (const def of chain) {
      if (def.tableStyle) {
        result = { ...result, ...def.tableStyle };
      }
    }

    return result;
  }
}
