import type { DrawingShapeNode, ImageNode } from '../../types/ast.js';
import type { Rect } from '../../types/common.js';
import type { TabLeader, TextStyle } from '../../types/style.js';
import type { BorderStyle, CellBox } from '../../layout/page-engine.js';
import { measureTextWidth } from '../../layout/text-metrics.js';
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
  drawCellBox(target: CanvasTarget, cell: CellBox): void;
  drawBorderLine(target: CanvasTarget, x1: number, y1: number, x2: number, y2: number, border: BorderStyle): void;
}

export class StandardDrawPrimitives implements DrawPrimitives {
  drawText(target: CanvasTarget, text: string, x: number, y: number, baseline: number, style?: TextStyle): void {
    if (!text || text.length === 0) return;

    const fontSize = style?.fontSizePt ?? 11;
    const fontFamily = style?.fontFamily ?? 'Calibri, sans-serif';
    const isBold = Boolean(style?.bold);
    const isItalic = Boolean(style?.italic);
    const color = style?.color ?? '#000000';
    // Super/subscript runs are drawn smaller and shifted off the shared
    // baseline instead of being rendered as normal text (v2 N14).
    const isSuperscript = style?.verticalAlign === 'superscript';
    const isSubscript = style?.verticalAlign === 'subscript';
    const scriptFactor = isSuperscript || isSubscript ? 0.75 : 1;
    const baselineShift = isSuperscript ? -fontSize * 0.33 : isSubscript ? fontSize * 0.15 : 0;
    const drawFontSize = fontSize * scriptFactor;

    // 1. Draw background highlight if present
    if (style?.backgroundColor) {
      target.save();
      target.fillStyle = style.backgroundColor;
      // Measured text width (shared heuristics) instead of the old
      // length-based guess — and always measured, never the magic 20pt
      // fallback for font-less targets (v1 F7).
      target.fillRect(x, y, measureTextWidth(text, drawFontSize, isBold, fontFamily), fontSize * 1.2);
      target.restore();
    }

    // 2. Setup font and color
    target.save();
    target.font = `${isItalic ? 'italic ' : ''}${isBold ? 'bold ' : ''}${drawFontSize}pt ${fontFamily}`;
    target.fillStyle = color;

    // 3. Draw text at baseline (shifted for super/subscript)
    const drawBaseline = y + baseline + baselineShift;
    target.fillText(text, x, drawBaseline);

    // 4. Draw underline if present (follows the shifted baseline)
    if (style?.underline) {
      target.fillRect(x, drawBaseline + 2, measureTextWidth(text, drawFontSize, isBold, fontFamily), 1);
    }

    // 5. Draw strikethrough if present
    if (style?.strike) {
      target.fillRect(x, drawBaseline - drawFontSize * 0.3, measureTextWidth(text, drawFontSize, isBold, fontFamily), 1);
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

  drawCellBox(target: CanvasTarget, cell: CellBox): void {
    const { x, y, width, height } = cell.bounds;
    if (width <= 0 || height <= 0) return;

    // 1. Draw cell background fill if present
    if (cell.backgroundColor) {
      target.save();
      target.fillStyle = cell.backgroundColor;
      target.fillRect(x, y, width, height);
      target.restore();
    }

    // 2. Draw 4 borders if present
    if (cell.borderTop) {
      this.drawBorderLine(target, x, y, x + width, y, cell.borderTop);
    }
    if (cell.borderBottom) {
      this.drawBorderLine(target, x, y + height, x + width, y + height, cell.borderBottom);
    }
    if (cell.borderLeft) {
      this.drawBorderLine(target, x, y, x, y + height, cell.borderLeft);
    }
    if (cell.borderRight) {
      this.drawBorderLine(target, x + width, y, x + width, y + height, cell.borderRight);
    }
  }

  drawBorderLine(target: CanvasTarget, x1: number, y1: number, x2: number, y2: number, border: BorderStyle): void {
    if (!border || border.style === 'none' || border.style === 'nil') return;
    const color = border.color ?? '#000000';
    const width = border.widthPt ?? 1;

    target.save();
    target.strokeStyle = color;
    target.fillStyle = color;
    target.lineWidth = width;

    if (border.style === 'dashed' && target.setLineDash) {
      target.setLineDash([4, 2]);
    } else if (border.style === 'dotted' && target.setLineDash) {
      target.setLineDash([1, 2]);
    }

    if (target.beginPath && target.moveTo && target.lineTo && target.stroke) {
      target.beginPath();
      target.moveTo(x1, y1);
      target.lineTo(x2, y2);
      target.stroke();
    } else if (target.fillRect) {
      const isHorizontal = Math.abs(y2 - y1) < 0.1;
      if (isHorizontal) {
        target.fillRect(Math.min(x1, x2), y1 - width / 2, Math.abs(x2 - x1), width);
      } else {
        target.fillRect(x1 - width / 2, Math.min(y1, y2), width, Math.abs(y2 - y1));
      }
    }

    target.restore();
  }
}

export const defaultDrawPrimitives = new StandardDrawPrimitives();
