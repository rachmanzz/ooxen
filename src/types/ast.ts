import type { Margins, Size } from './common.js';
import type { ParagraphStyle, TableCellStyle, TextStyle } from './style.js';

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
  | 'footer';

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

export interface RunNode extends BaseASTNode {
  type: 'run';
  text: string;
  style?: TextStyle;
  drawing?: DrawingShapeNode;
  image?: ImageNode;
  field?: 'PAGE' | 'NUMPAGES' | string;
}

export interface ParagraphNode extends BaseASTNode {
  type: 'paragraph';
  style?: ParagraphStyle;
  children: RunNode[];
}

export interface TableCellNode extends BaseASTNode {
  type: 'table-cell';
  style?: TableCellStyle;
  colSpan?: number;
  rowSpan?: number;
  children: BlockNode[];
}

export interface TableRowNode extends BaseASTNode {
  type: 'table-row';
  children: TableCellNode[];
}

export interface TableNode extends BaseASTNode {
  type: 'table';
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

export interface SectionProperties {
  pageSize: Size; // points
  margins: Margins; // points
  headerDistancePt?: number; // distance from top of page to header (default: 36 pt / 720 twips)
  footerDistancePt?: number; // distance from bottom of page to footer (default: 36 pt / 720 twips)
  titlePg?: boolean; // whether first page has different header/footer
}

export interface SectionNode extends BaseASTNode {
  type: 'section';
  properties: SectionProperties;
  children: BlockNode[];
  headers?: SectionHeaders;
  footers?: SectionFooters;
}

export interface DocumentNode extends BaseASTNode {
  type: 'document';
  sections: SectionNode[];
}
