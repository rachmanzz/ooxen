import type { Margins, Size } from './common.js';
import type { ParagraphStyle, TableCellStyle, TableStyle, TextStyle } from './style.js';

/**
 * Universal Document AST (Abstract Syntax Tree) representing ISO/IEC 29500 WordprocessingML and DrawingML.
 */

export type ASTNodeType =
  | 'document'
  | 'section'
  | 'paragraph'
  | 'run'
  | 'table'
  | 'table-row'
  | 'table-cell'
  | 'drawing'
  | 'image'
  | 'header'
  | 'footer'
  | 'footnote'
  | 'endnote'
  | 'comment';

export interface BaseASTNode {
  type: ASTNodeType;
}

export type VectorPathCommandType =
  | 'moveTo'
  | 'lineTo'
  | 'cubicBezTo'
  | 'quadBezTo'
  | 'arcTo'
  | 'close';

export interface VectorPathCommand {
  type: VectorPathCommandType;
  points: number[];
}

export interface DrawingShapeNode extends BaseASTNode {
  type: 'drawing';
  id?: string;
  name?: string;
  widthPt: number;
  heightPt: number;
  commands: VectorPathCommand[];
  fill?: string;
  stroke?: {
    color: string;
    widthPt: number;
  };
}

export interface ImageNode extends BaseASTNode {
  type: 'image';
  id?: string;
  name?: string;
  altText?: string;
  widthPt: number;
  heightPt: number;
  src?: string;
  data?: Uint8Array;
  mimeType?: string;
  relationshipId?: string;
}

export interface HyperlinkInfo {
  url?: string;
  anchor?: string;
  tooltip?: string;
}

export interface FootnoteReference {
  id: number;
  kind: 'footnote' | 'endnote';
  mark?: string;
}

export type RevisionType = 'insert' | 'delete';

export interface RevisionInfo {
  type: RevisionType;
  id?: string;
  author?: string;
  date?: string;
}

export interface RunNode extends BaseASTNode {
  type: 'run';
  text: string;
  style?: TextStyle;
  drawing?: DrawingShapeNode;
  image?: ImageNode;
  field?: 'PAGE' | 'NUMPAGES' | string;
  hyperlink?: HyperlinkInfo;
  bookmarkName?: string;
  footnoteRef?: FootnoteReference;
  isFootnoteRefMark?: boolean;
  commentId?: string;
  breakType?: 'page' | 'column';
  revision?: RevisionInfo;
}

export interface ParagraphNode extends BaseASTNode {
  type: 'paragraph';
  style?: ParagraphStyle;
  children: RunNode[];
  bookmarkName?: string;
}

export interface TableCellNode extends BaseASTNode {
  type: 'table-cell';
  style?: TableCellStyle;
  widthPt?: number;
  colSpan?: number;
  rowSpan?: number;
  vMerge?: 'restart' | 'continue';
  children: BlockNode[];
}

export interface TableRowNode extends BaseASTNode {
  type: 'table-row';
  heightPt?: number;
  cantSplit?: boolean;
  tblHeader?: boolean;
  children: TableCellNode[];
}

export interface TableNode extends BaseASTNode {
  type: 'table';
  style?: TableStyle;
  columnWidthsPt?: number[];
  rows: TableRowNode[];
}

export type BlockNode = ParagraphNode | TableNode | DrawingShapeNode | ImageNode;

export type HeaderFooterType = 'default' | 'first' | 'even';

export interface HeaderFooterNode extends BaseASTNode {
  type: 'header' | 'footer';
  kind: HeaderFooterType;
  children: BlockNode[];
}

export interface SectionHeaders {
  default?: HeaderFooterNode;
  first?: HeaderFooterNode;
  even?: HeaderFooterNode;
}

export interface SectionFooters {
  default?: HeaderFooterNode;
  first?: HeaderFooterNode;
  even?: HeaderFooterNode;
}

export interface ColumnProperties {
  widthPt: number;
  spacePt?: number;
}

export interface SectionColumns {
  count: number; // number of columns (default: 1)
  spacePt?: number; // spacing between equal-width columns in points (default: 36 pt / 720 twips)
  equalWidth?: boolean; // default: true
  separator?: boolean; // vertical separator line between columns
  columns?: ColumnProperties[]; // explicit column definitions when not equal width
}

export type SectionBreakType = 'continuous' | 'nextPage' | 'evenPage' | 'oddPage' | 'nextColumn';
export type PageOrientation = 'portrait' | 'landscape';

export interface PageNumberingProperties {
  start?: number; // Starting page number (w:start)
  format?: string; // Numbering format e.g. 'decimal' | 'upperRoman' | 'lowerRoman' | 'upperLetter' | 'lowerLetter' (w:fmt)
}

export interface SectionProperties {
  pageSize: Size; // points
  margins: Margins; // points
  headerDistancePt?: number; // distance from top of page to header (default: 36 pt / 720 twips)
  footerDistancePt?: number; // distance from bottom of page to footer (default: 36 pt / 720 twips)
  titlePg?: boolean; // whether first page has different header/footer
  columns?: SectionColumns;
  type?: SectionBreakType;
  orientation?: PageOrientation;
  pageNumbering?: PageNumberingProperties;
}

export interface SectionNode extends BaseASTNode {
  type: 'section';
  properties: SectionProperties;
  children: BlockNode[];
  headers?: SectionHeaders;
  footers?: SectionFooters;
}

export interface DocumentMetadata {
  title?: string;
  creator?: string; // author / dc:creator
  subject?: string;
  description?: string;
  keywords?: string[];
  lastModifiedBy?: string;
  revision?: string | number;
  created?: string; // ISO 8601 string
  modified?: string; // ISO 8601 string
  application?: string;
  company?: string;
  pages?: number;
  words?: number;
  characters?: number;
  paragraphs?: number;
  lines?: number;
}

export interface FootnoteNode extends BaseASTNode {
  type: 'footnote' | 'endnote';
  id: number;
  kind: 'footnote' | 'endnote';
  typeCategory?: 'normal' | 'separator' | 'continuationSeparator';
  children: BlockNode[];
}

export interface CommentNode extends BaseASTNode {
  type: 'comment';
  id: string;
  author?: string;
  date?: string; // ISO 8601 string
  initials?: string;
  children: BlockNode[];
}

export interface DocumentNode extends BaseASTNode {
  type: 'document';
  sections: SectionNode[];
  metadata?: DocumentMetadata;
  footnotes?: FootnoteNode[];
  endnotes?: FootnoteNode[];
  comments?: CommentNode[];
}
