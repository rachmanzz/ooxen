/**
 * Style and formatting models for OOXML WordprocessingML.
 */

export type TextAlignment = 'left' | 'center' | 'right' | 'justify';

export interface TextStyle {
  fontFamily?: string;
  fontSizePt?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  color?: string; // hex color e.g. "#000000"
  backgroundColor?: string;
  verticalAlign?: 'superscript' | 'subscript' | 'baseline';
}

export interface ParagraphNumbering {
  numId: number;
  level: number;
  format?: string; // 'decimal' | 'bullet' | 'lowerLetter' | 'upperLetter' | 'lowerRoman' | 'upperRoman'
  prefixText?: string; // e.g. "1.", "•", "a)"
}

export interface ParagraphStyle {
  alignment?: TextAlignment;
  lineSpacingPt?: number;
  spaceBeforePt?: number;
  spaceAfterPt?: number;
  indentLeftPt?: number;
  indentRightPt?: number;
  firstLineIndentPt?: number;
  numbering?: ParagraphNumbering;
  pageBreakBefore?: boolean;
  keepNext?: boolean;
  keepLines?: boolean;
}

export interface TableCellStyle {
  backgroundColor?: string;
  borderTop?: string;
  borderRight?: string;
  borderBottom?: string;
  borderLeft?: string;
  paddingTopPt?: number;
  paddingRightPt?: number;
  paddingBottomPt?: number;
  paddingLeftPt?: number;
  verticalAlign?: 'top' | 'center' | 'bottom';
}

export interface TableStyle {
  alignment?: 'left' | 'center' | 'right';
  widthPt?: number;
  widthPercent?: number;
  borderTop?: string;
  borderRight?: string;
  borderBottom?: string;
  borderLeft?: string;
  borderInsideH?: string;
  borderInsideV?: string;
  cellMarginTopPt?: number;
  cellMarginRightPt?: number;
  cellMarginBottomPt?: number;
  cellMarginLeftPt?: number;
}
