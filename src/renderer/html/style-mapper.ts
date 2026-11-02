import type { ParagraphStyle, TextStyle } from '../../types/style.js';

/**
 * Maps OOXML styling properties to CSS inline declarations.
 */

export interface StyleMapper {
  textStyleToCss(style?: TextStyle): Record<string, string>;
  paragraphStyleToCss(style?: ParagraphStyle): Record<string, string>;
  toCssString(styles: Record<string, string>): string;
}

export class StandardStyleMapper implements StyleMapper {
  textStyleToCss(style?: TextStyle): Record<string, string> {
    const css: Record<string, string> = {};
    if (!style) return css;

    if (style.fontFamily) css['font-family'] = style.fontFamily;
    if (style.fontSizePt) css['font-size'] = `${style.fontSizePt}pt`;
    if (style.bold) css['font-weight'] = 'bold';
    if (style.italic) css['font-style'] = 'italic';

    const decorations: string[] = [];
    if (style.underline) decorations.push('underline');
    if (style.strike) decorations.push('line-through');
    if (decorations.length > 0) {
      css['text-decoration'] = decorations.join(' ');
    }

    if (style.color) css['color'] = style.color;
    if (style.backgroundColor) css['background-color'] = style.backgroundColor;
    if (style.verticalAlign) {
      css['vertical-align'] = style.verticalAlign;
      if (style.verticalAlign === 'superscript') {
        css['font-size'] = '0.75em';
      } else if (style.verticalAlign === 'subscript') {
        css['font-size'] = '0.75em';
      }
    }

    return css;
  }

  paragraphStyleToCss(style?: ParagraphStyle): Record<string, string> {
    const css: Record<string, string> = {};
    if (!style) return css;

    if (style.alignment) {
      css['text-align'] = style.alignment;
    }
    if (style.spaceBeforePt) {
      css['margin-top'] = `${style.spaceBeforePt}pt`;
    }
    if (style.spaceAfterPt) {
      css['margin-bottom'] = `${style.spaceAfterPt}pt`;
    }
    if (style.indentLeftPt) {
      css['margin-left'] = `${style.indentLeftPt}pt`;
    }
    if (style.indentRightPt) {
      css['margin-right'] = `${style.indentRightPt}pt`;
    }
    if (style.firstLineIndentPt) {
      css['text-indent'] = `${style.firstLineIndentPt}pt`;
    }
    if (style.lineSpacingPt) {
      css['line-height'] = `${style.lineSpacingPt}pt`;
    }

    return css;
  }

  toCssString(styles: Record<string, string>): string {
    return Object.entries(styles)
      .map(([prop, val]) => `${prop}: ${val};`)
      .join(' ');
  }
}

export const defaultStyleMapper = new StandardStyleMapper();
