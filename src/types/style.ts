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
}
