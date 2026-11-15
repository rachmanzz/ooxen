import { twipsToPt } from '../../types/common.js';
import type { LineSpacingRule, ParagraphStyle, TableStyle, TabLeader, TabStop, TabStopAlignment, TextStyle } from '../../types/style.js';
import { parseTablePropertiesNode } from './table-properties.js';
import { localName, parseOnOff, type XmlNode } from '../xml-adapter.js';

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

/**
 * Fonts of the document theme's `a:fontScheme` (ISO/IEC 29500-1
 * §20.1.4.1.18): the major (heading) and minor (body) faces for Latin,
 * East Asian, and complex-script text. Empty typefaces are left unset.
 */
export interface ThemeFonts {
  majorLatin?: string;
  majorEastAsia?: string;
  majorComplex?: string;
  minorLatin?: string;
  minorEastAsia?: string;
  minorComplex?: string;
}

function findDescendant(node: XmlNode, name: string): XmlNode | undefined {
  for (const child of node.children) {
    if (localName(child.nodeName) === name) return child;
    const hit = findDescendant(child, name);
    if (hit) return hit;
  }
  return undefined;
}

/** Reads the font scheme out of a parsed `word/theme/theme1.xml` tree. */
export function parseThemeFonts(themeRoot: XmlNode): ThemeFonts {
  const scheme = localName(themeRoot.nodeName) === 'fontscheme' ? themeRoot : findDescendant(themeRoot, 'fontscheme');
  const fonts: ThemeFonts = {};
  if (!scheme) return fonts;
  const face = (group: XmlNode, name: string): string | undefined => {
    const el = group.children.find((c) => localName(c.nodeName) === name);
    const typeface = el?.attributes['typeface']?.trim();
    return typeface ? typeface : undefined;
  };
  for (const group of scheme.children) {
    const tag = localName(group.nodeName);
    if (tag === 'majorfont') {
      fonts.majorLatin = face(group, 'latin');
      fonts.majorEastAsia = face(group, 'ea');
      fonts.majorComplex = face(group, 'cs');
    } else if (tag === 'minorfont') {
      fonts.minorLatin = face(group, 'latin');
      fonts.minorEastAsia = face(group, 'ea');
      fonts.minorComplex = face(group, 'cs');
    }
  }
  return fonts;
}

/**
 * Resolves an ST_Theme token (`majorHAnsi`, `minorEastAsia`, ...) to the
 * theme face it names; undefined when the theme has no such face.
 */
export function themeFontFor(token: string | undefined, fonts: ThemeFonts | undefined): string | undefined {
  if (!token || !fonts) return undefined;
  const t = token.toLowerCase();
  const major = t.startsWith('major');
  if (t.endsWith('eastasia')) return (major ? fonts.majorEastAsia : fonts.minorEastAsia) ?? (major ? fonts.majorLatin : fonts.minorLatin);
  if (t.endsWith('bidi')) return (major ? fonts.majorComplex : fonts.minorComplex) ?? (major ? fonts.majorLatin : fonts.minorLatin);
  return major ? fonts.majorLatin : fonts.minorLatin;
}

/**
 * Parses a `w:rPr`. `themeFonts` resolves theme font references in
 * `w:rFonts` (§17.3.2.26: a theme attribute takes precedence over its
 * literal sibling); without a theme the literal attribute is used.
 */
export function parseRunProperties(node?: XmlNode, themeFonts?: ThemeFonts): TextStyle {
  if (!node) return {};
  const style: TextStyle = {};

  for (const child of node.children) {
    const tag = localName(child.nodeName);
    const val = child.attributes['w:val'] ?? child.attributes['val'];

    switch (tag) {
      case 'rfonts': {
        const attr = (name: string): string | undefined => child.attributes[`w:${name}`] ?? child.attributes[name];
        const font =
          themeFontFor(attr('asciiTheme') ?? attr('hAnsiTheme'), themeFonts) ??
          attr('ascii') ??
          attr('hAnsi') ??
          val;
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
    const tag = localName(child.nodeName);
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
        const lineRuleRaw = (
          child.attributes['w:lineRule'] ?? child.attributes['lineRule'] ?? child.attributes['w:linerule'] ?? child.attributes['linerule'] ?? 'auto'
        ).toLowerCase();
        const lineRule: LineSpacingRule =
          lineRuleRaw === 'exact' ? 'exact' : lineRuleRaw === 'atleast' ? 'atLeast' : lineRuleRaw === 'atmost' ? 'atMost' : 'auto';

        if (before) style.spaceBeforePt = twipsToPt(Number(before));
        if (after) style.spaceAfterPt = twipsToPt(Number(after));
        if (line) {
          const lineVal = Number(line);
          style.lineSpacingRule = lineRule;
          if (lineRule !== 'auto') {
            // With an explicit rule, w:line is in twips.
            style.lineSpacingPt = twipsToPt(lineVal);
            style.lineSpacingMultiple = undefined;
          } else {
            // lineRule="auto" (the default): w:line is in 240ths of a line
            // (v2 N9). The multiple scales the real line height at layout
            // time; the point value approximates it on an 11pt line.
            const multiple = lineVal / 240;
            style.lineSpacingMultiple = multiple;
            style.lineSpacingPt = multiple * 13.2;
          }
        }
        break;
      }
      case 'ind': {
        // w:start/w:end are the strict spellings of w:left/w:right
        // (§17.3.1.12). w:hanging outranks w:firstLine when both appear.
        const attr = (name: string): string | undefined => child.attributes[`w:${name}`] ?? child.attributes[name];
        const left = attr('left') ?? attr('start');
        const right = attr('right') ?? attr('end');
        const firstLine = attr('firstLine') ?? attr('firstline');
        const hanging = attr('hanging');

        if (left) style.indentLeftPt = twipsToPt(Number(left));
        if (right) style.indentRightPt = twipsToPt(Number(right));
        if (hanging) style.firstLineIndentPt = -twipsToPt(Number(hanging));
        else if (firstLine) style.firstLineIndentPt = twipsToPt(Number(firstLine));
        break;
      }
      case 'contextualspacing': {
        style.contextualSpacing = parseOnOff(val) ?? true;
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
          const tabTag = localName(tabChild.nodeName);
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
  /** Loads the theme font scheme; may be called before or after loadStyles. */
  loadTheme?(themeXmlNode: XmlNode): void;
  getThemeFonts?(): ThemeFonts;
  /** Paragraph style chain for `styleId`, or the default paragraph style when absent. */
  resolveParagraphStyle(styleId?: string): ParagraphStyle;
  /** Run style chain for one style id, seeded with the document defaults. */
  resolveRunStyle(styleId?: string): TextStyle;
  /**
   * Run style for text inside a paragraph (§17.7.2): document defaults,
   * then the paragraph style chain (default paragraph style when none is
   * named), then the character style chain. Direct `w:rPr` goes on top.
   */
  resolveRunStyleInParagraph?(paragraphStyleId?: string, runStyleId?: string): TextStyle;
  resolveTableStyle(styleId?: string): TableStyle;
  getDefaultRunStyle(): TextStyle;
  getDefaultParagraphStyle(): ParagraphStyle;
}

export class StandardStyleResolver implements StyleResolver {
  private styles = new Map<string, StyleDefinition>();
  private stylesXmlNode: XmlNode | undefined;
  private themeFonts: ThemeFonts = {};
  /** The `w:default="1"` paragraph style (usually Normal), applied when a paragraph names none. */
  private defaultParagraphStyleId: string | undefined;
  private readonly builtinRunStyle: TextStyle = {
    fontFamily: 'Calibri',
    fontSizePt: 11,
    color: '#000000',
  };
  private readonly builtinParagraphStyle: ParagraphStyle = {
    alignment: 'left',
  };
  private defaultRunStyle: TextStyle = { ...this.builtinRunStyle };
  private defaultParagraphStyle: ParagraphStyle = { ...this.builtinParagraphStyle };

  loadTheme(themeXmlNode: XmlNode): void {
    this.themeFonts = parseThemeFonts(themeXmlNode);
    // Style definitions were parsed against the previous theme; redo them.
    if (this.stylesXmlNode) this.loadStyles(this.stylesXmlNode);
  }

  getThemeFonts(): ThemeFonts {
    return { ...this.themeFonts };
  }

  loadStyles(stylesXmlNode: XmlNode): void {
    this.stylesXmlNode = stylesXmlNode;
    this.styles.clear();
    this.defaultParagraphStyleId = undefined;
    this.defaultRunStyle = { ...this.builtinRunStyle };
    this.defaultParagraphStyle = { ...this.builtinParagraphStyle };

    for (const child of stylesXmlNode.children) {
      const tag = localName(child.nodeName);

      if (tag === 'docdefaults') {
        this.parseDocDefaults(child);
      } else if (tag === 'style') {
        this.parseStyleNode(child);
      }
    }
  }

  private parseDocDefaults(node: XmlNode): void {
    for (const child of node.children) {
      const tag = localName(child.nodeName);
      if (tag === 'rprdefault') {
        const rPr = child.children.find((c) => c.nodeName.endsWith('rPr') || c.nodeName === 'rPr');
        if (rPr) {
          this.defaultRunStyle = { ...this.defaultRunStyle, ...parseRunProperties(rPr, this.themeFonts) };
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
      const tag = localName(child.nodeName);
      const val = child.attributes['w:val'] ?? child.attributes['val'];

      if (tag === 'basedon') {
        basedOn = val;
      } else if (tag === 'name') {
        name = val;
      } else if (tag === 'ppr') {
        paragraphStyle = parseParagraphProperties(child);
      } else if (tag === 'rpr') {
        textStyle = parseRunProperties(child, this.themeFonts);
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
    if (isDefault && type === 'paragraph') this.defaultParagraphStyleId = id;
  }

  /** Base-first style chain for an id (cycle-safe). */
  private chain(styleId: string | undefined): StyleDefinition[] {
    const chain: StyleDefinition[] = [];
    let current = styleId ? this.styles.get(styleId) : undefined;
    const visited = new Set<string>();
    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      chain.unshift(current);
      current = current.basedOn ? this.styles.get(current.basedOn) : undefined;
    }
    return chain;
  }

  private applyRunChain(base: TextStyle, styleId: string | undefined): TextStyle {
    let result = base;
    for (const def of this.chain(styleId)) {
      if (def.textStyle) result = { ...result, ...def.textStyle };
    }
    return result;
  }

  getDefaultRunStyle(): TextStyle {
    return { ...this.defaultRunStyle };
  }

  getDefaultParagraphStyle(): ParagraphStyle {
    return { ...this.defaultParagraphStyle };
  }

  resolveParagraphStyle(styleId?: string): ParagraphStyle {
    let result: ParagraphStyle = { ...this.defaultParagraphStyle };
    for (const def of this.chain(styleId ?? this.defaultParagraphStyleId)) {
      if (def.paragraphStyle) {
        result = { ...result, ...def.paragraphStyle };
      }
    }
    return result;
  }

  resolveRunStyle(styleId?: string): TextStyle {
    return this.applyRunChain({ ...this.defaultRunStyle }, styleId ?? this.defaultParagraphStyleId);
  }

  resolveRunStyleInParagraph(paragraphStyleId?: string, runStyleId?: string): TextStyle {
    const inParagraph = this.applyRunChain({ ...this.defaultRunStyle }, paragraphStyleId ?? this.defaultParagraphStyleId);
    return runStyleId ? this.applyRunChain(inParagraph, runStyleId) : inParagraph;
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
