import type { Rect } from '../../types/common.js';
import type { TextStyle } from '../../types/style.js';
import type { CanvasTarget } from './canvas-target.js';

/**
 * Primitive drawing routines onto CanvasTarget.
 */

export interface DrawPrimitives {
  drawText(target: CanvasTarget, text: string, x: number, y: number, baseline: number, style?: TextStyle): void;
  drawRect(target: CanvasTarget, rect: Rect, fillColor?: string, strokeColor?: string, strokeWidth?: number): void;
}

export class StandardDrawPrimitives implements DrawPrimitives {
  drawText(target: CanvasTarget, text: string, x: number, y: number, baseline: number, style?: TextStyle): void {
    if (!text || text.length === 0) return;

    const fontSize = style?.fontSizePt ?? 11;
    const fontFamily = style?.fontFamily ?? 'Calibri, sans-serif';
    const isBold = Boolean(style?.bold);
    const isItalic = Boolean(style?.italic);
    const color = style?.color ?? '#000000';

    // 1. Draw background highlight if present
    if (style?.backgroundColor) {
      target.save();
      target.fillStyle = style.backgroundColor;
      target.fillRect(x, y, target.font ? fontSize * text.length * 0.55 : 20, fontSize * 1.2);
      target.restore();
    }

    // 2. Setup font and color
    target.save();
    target.font = `${isItalic ? 'italic ' : ''}${isBold ? 'bold ' : ''}${fontSize}pt ${fontFamily}`;
    target.fillStyle = color;

    // 3. Draw text at baseline
    target.fillText(text, x, y + baseline);

    // 4. Draw underline if present
    if (style?.underline) {
      target.fillRect(x, y + baseline + 2, fontSize * text.length * 0.55, 1);
    }

    // 5. Draw strikethrough if present
    if (style?.strike) {
      target.fillRect(x, y + baseline - fontSize * 0.3, fontSize * text.length * 0.55, 1);
    }

    target.restore();
  }

  drawRect(target: CanvasTarget, rect: Rect, fillColor?: string, strokeColor?: string, strokeWidth: number = 1): void {
    target.save();
    if (fillColor) {
      target.fillStyle = fillColor;
      target.fillRect(rect.x, rect.y, rect.width, rect.height);
    }
    if (strokeColor) {
      target.strokeStyle = strokeColor;
      target.lineWidth = strokeWidth;
      target.strokeRect(rect.x, rect.y, rect.width, rect.height);
    }
    target.restore();
  }
}

export const defaultDrawPrimitives = new StandardDrawPrimitives();
