import type { ParagraphNode } from '../types/ast.js';
import type { Rect } from '../types/common.js';
import type { TextStyle } from '../types/style.js';

/**
 * Line breaking and word wrapping layout model.
 */

export interface LineFragment {
  text: string;
  style: TextStyle;
  bounds: Rect; // relative to line or page
}

export interface LayoutLine {
  bounds: Rect;
  fragments: LineFragment[];
}

export interface LineBreaker {
  breakParagraph(paragraph: ParagraphNode, availableWidth: number): LayoutLine[];
}
