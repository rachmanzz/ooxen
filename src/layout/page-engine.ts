import type { DocumentNode } from '../types/ast.js';
import type { Margins, Size } from '../types/common.js';
import type { LayoutLine } from './line-breaker.js';

/**
 * Geometric layout and pagination model.
 */

export interface PageLayout {
  pageIndex: number;
  size: Size; // points
  margins: Margins; // points
  lines: LayoutLine[];
}

export interface PageEngine {
  layoutDocument(document: DocumentNode): PageLayout[];
}
