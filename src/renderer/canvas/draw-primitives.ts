import type { DrawingShapeNode, ImageNode } from '../../types/ast.js';
import type { Rect } from '../../types/common.js';
import type { TabLeader, TextStyle } from '../../types/style.js';
import type { CanvasTarget } from './canvas-target.js';

/**
 * Primitive drawing routines onto CanvasTarget.
 */

export interface DrawPrimitives {
  drawText(target: CanvasTarget, text: string, x: number, y: number, baseline: number, style?: TextStyle): void;
  drawRect(target: CanvasTarget, rect: Rect, fillColor?: string, strokeColor?: string, strokeWidth?: number): void;
  drawShape(target: CanvasTarget, shape: DrawingShapeNode, x: number, y: number): void;
  drawImage(target: CanvasTarget, image: ImageNode, x: number, y: number): void;
  drawLeader(target: CanvasTarget, leader: TabLeader, x: number, y: number, width: number, baseline: number, style?: TextStyle): void;
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

  drawShape(target: CanvasTarget, shape: DrawingShapeNode, x: number, y: number): void {
    target.save();
    target.translate(x, y);

    if (target.beginPath) {
      target.beginPath();
      for (const cmd of shape.commands) {
        switch (cmd.type) {
          case 'moveTo':
            target.moveTo?.(cmd.points[0] ?? 0, cmd.points[1] ?? 0);
            break;
          case 'lineTo':
            target.lineTo?.(cmd.points[0] ?? 0, cmd.points[1] ?? 0);
            break;
          case 'cubicBezTo':
            target.bezierCurveTo?.(
              cmd.points[0] ?? 0,
              cmd.points[1] ?? 0,
              cmd.points[2] ?? 0,
              cmd.points[3] ?? 0,
              cmd.points[4] ?? 0,
              cmd.points[5] ?? 0,
            );
            break;
          case 'quadBezTo':
            target.quadraticCurveTo?.(
              cmd.points[0] ?? 0,
              cmd.points[1] ?? 0,
              cmd.points[2] ?? 0,
              cmd.points[3] ?? 0,
            );
            break;
          case 'close':
            target.closePath?.();
            break;
        }
      }

      if (shape.fill) {
        target.fillStyle = shape.fill;
        target.fill?.();
      }

      if (shape.stroke) {
        target.strokeStyle = shape.stroke.color;
        target.lineWidth = shape.stroke.widthPt;
        target.stroke?.();
      }
    } else {
      if (shape.fill) {
        target.fillStyle = shape.fill;
        target.fillRect(0, 0, shape.widthPt, shape.heightPt);
      }
      if (shape.stroke) {
        target.strokeStyle = shape.stroke.color;
        target.lineWidth = shape.stroke.widthPt;
        target.strokeRect(0, 0, shape.widthPt, shape.heightPt);
      }
    }

    target.restore();
  }

  drawImage(target: CanvasTarget, image: ImageNode, x: number, y: number): void {
    target.save();
    if (target.drawImage && image.src) {
      target.drawImage(image.src, x, y, image.widthPt, image.heightPt);
    } else {
      // Fallback placeholder rendering
      target.fillStyle = '#F0F0F0';
      target.fillRect(x, y, image.widthPt, image.heightPt);
      target.strokeStyle = '#CCCCCC';
      target.lineWidth = 1;
      target.strokeRect(x, y, image.widthPt, image.heightPt);
      if (image.altText || image.name) {
        target.fillStyle = '#666666';
        target.fillText(image.altText ?? image.name ?? '[Image]', x + 4, y + image.heightPt / 2);
      }
    }
    target.restore();
  }

  drawLeader(target: CanvasTarget, leader: TabLeader, x: number, y: number, width: number, baseline: number, style?: TextStyle): void {
    if (!leader || leader === 'none' || width <= 0) return;

    const fontSize = style?.fontSizePt ?? 11;
    const fontFamily = style?.fontFamily ?? 'Calibri, sans-serif';
    const color = style?.color ?? '#000000';

    target.save();
    target.fillStyle = color;
    target.font = `${fontSize}pt ${fontFamily}`;

    if (leader === 'dot' || leader === 'middleDot') {
      const char = leader === 'middleDot' ? '·' : '.';
      const step = 6;
      const dotY = leader === 'middleDot' ? y + baseline - fontSize * 0.25 : y + baseline;
      for (let dx = 2; dx < width - 2; dx += step) {
        target.fillText(char, x + dx, dotY);
      }
    } else if (leader === 'hyphen') {
      const step = 8;
      const hyphenWidth = 4;
      const hyphenY = y + baseline - fontSize * 0.3;
      for (let dx = 2; dx < width - 2; dx += step) {
        const segWidth = Math.min(hyphenWidth, width - dx - 2);
        target.fillRect(x + dx, hyphenY, segWidth, 1);
      }
    } else if (leader === 'underscore') {
      target.fillRect(x, y + baseline + 1.5, width, 1);
    } else if (leader === 'heavy') {
      target.fillRect(x, y + baseline + 1.5, width, 2);
    }

    target.restore();
  }
}

export const defaultDrawPrimitives = new StandardDrawPrimitives();
