import type { Margins, Size } from './common.js';
import type { ParagraphStyle, TableCellStyle, TextStyle } from './style.js';

/**
 * Universal Document AST (Abstract Syntax Tree) representing ISO/IEC 29500 WordprocessingML and DrawingML.
 */

export type ASTNodeType = 'document' | 'section' | 'paragraph' | 'run' | 'table' | 'table-row' | 'table-cell' | 'drawing';

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

export interface RunNode extends BaseASTNode {
  type: 'run';
  text: string;
  style?: TextStyle;
  drawing?: DrawingShapeNode;
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

export type BlockNode = ParagraphNode | TableNode | DrawingShapeNode;

export interface SectionProperties {
  pageSize: Size; // points
  margins: Margins; // points
}

export interface SectionNode extends BaseASTNode {
  type: 'section';
  properties: SectionProperties;
  children: BlockNode[];
}

export interface DocumentNode extends BaseASTNode {
  type: 'document';
  sections: SectionNode[];
}
