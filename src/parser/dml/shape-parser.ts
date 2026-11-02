import type { XmlNode } from '../xml-adapter.js';

/**
 * Basic DrawingML shape parser interface.
 */

export interface DrawingShape {
  id: string;
  name?: string;
  widthPt: number;
  heightPt: number;
}

export interface ShapeParser {
  parseDrawing(node: XmlNode): DrawingShape | undefined;
}
