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

export interface ParagraphStyle {
  alignment?: TextAlignment;
  lineSpacingPt?: number;
  spaceBeforePt?: number;
  spaceAfterPt?: number;
  indentLeftPt?: number;
  indentRightPt?: number;
  firstLineIndentPt?: number;
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
