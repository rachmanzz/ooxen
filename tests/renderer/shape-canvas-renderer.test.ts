import { describe, expect, it } from 'bun:test';
import type { DrawingShapeNode, PageLayout } from '../../src/index.js';
import type { CanvasTarget } from '../../src/renderer/canvas/canvas-target.js';
import { StandardDrawPrimitives } from '../../src/renderer/canvas/draw-primitives.js';
import { StandardPageRenderer } from '../../src/renderer/canvas/page-renderer.js';

interface PathCall {
  method: string;
  args: any[];
}

class FullMockCanvasTarget implements CanvasTarget {
  font: string = '';
  fillStyle: string = '#000000';
  strokeStyle: string = '#000000';
  lineWidth: number = 1;
  calls: PathCall[] = [];

  save(): void {
    this.calls.push({ method: 'save', args: [] });
  }

  restore(): void {
    this.calls.push({ method: 'restore', args: [] });
  }

  translate(x: number, y: number): void {
    this.calls.push({ method: 'translate', args: [x, y] });
  }

  scale(x: number, y: number): void {
    this.calls.push({ method: 'scale', args: [x, y] });
  }

  fillText(text: string, x: number, y: number): void {
    this.calls.push({ method: 'fillText', args: [text, x, y] });
  }

  strokeRect(x: number, y: number, w: number, h: number): void {
    this.calls.push({ method: 'strokeRect', args: [x, y, w, h] });
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    this.calls.push({ method: 'fillRect', args: [x, y, w, h] });
  }

  beginPath(): void {
    this.calls.push({ method: 'beginPath', args: [] });
  }

  closePath(): void {
    this.calls.push({ method: 'closePath', args: [] });
  }

  moveTo(x: number, y: number): void {
    this.calls.push({ method: 'moveTo', args: [x, y] });
  }

  lineTo(x: number, y: number): void {
    this.calls.push({ method: 'lineTo', args: [x, y] });
  }

  bezierCurveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number): void {
    this.calls.push({ method: 'bezierCurveTo', args: [cp1x, cp1y, cp2x, cp2y, x, y] });
  }

  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void {
    this.calls.push({ method: 'quadraticCurveTo', args: [cpx, cpy, x, y] });
  }

  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number): void {
    this.calls.push({ method: 'arc', args: [x, y, radius, startAngle, endAngle] });
  }

  fill(): void {
    this.calls.push({ method: 'fill', args: [this.fillStyle] });
  }

  stroke(): void {
    this.calls.push({ method: 'stroke', args: [this.strokeStyle, this.lineWidth] });
  }
}

describe('Vector Shape Canvas Renderer', () => {
  it('should draw vector path shape onto CanvasTarget', () => {
    const primitives = new StandardDrawPrimitives();
    const target = new FullMockCanvasTarget();

    const shape: DrawingShapeNode = {
      type: 'drawing',
      widthPt: 80,
      heightPt: 40,
      commands: [
        { type: 'moveTo', points: [0, 0] },
        { type: 'lineTo', points: [80, 0] },
        { type: 'cubicBezTo', points: [80, 20, 40, 40, 0, 40] },
        { type: 'close', points: [] },
      ],
      fill: '#FF0000',
      stroke: { color: '#003366', widthPt: 2 },
    };

    primitives.drawShape(target, shape, 50, 100);

    const methodNames = target.calls.map((c) => c.method);
    expect(methodNames).toContain('save');
    expect(methodNames).toContain('translate');
    expect(methodNames).toContain('beginPath');
    expect(methodNames).toContain('moveTo');
    expect(methodNames).toContain('lineTo');
    expect(methodNames).toContain('bezierCurveTo');
    expect(methodNames).toContain('closePath');
    expect(methodNames).toContain('fill');
    expect(methodNames).toContain('stroke');
    expect(methodNames).toContain('restore');

    const fillCall = target.calls.find((c) => c.method === 'fill');
    expect(fillCall?.args[0]).toBe('#FF0000');

    const strokeCall = target.calls.find((c) => c.method === 'stroke');
    expect(strokeCall?.args[0]).toBe('#003366');
    expect(strokeCall?.args[1]).toBe(2);
  });

  it('should render a page containing inline shape fragment', () => {
    const renderer = new StandardPageRenderer();
    const target = new FullMockCanvasTarget();

    const shape: DrawingShapeNode = {
      type: 'drawing',
      widthPt: 40,
      heightPt: 20,
      commands: [
        { type: 'moveTo', points: [0, 0] },
        { type: 'lineTo', points: [40, 20] },
      ],
      stroke: { color: '#008800', widthPt: 1 },
    };

    const page: PageLayout = {
      pageIndex: 0,
      size: { width: 595.28, height: 841.89 },
      margins: { top: 72, right: 72, bottom: 72, left: 72 },
      lines: [
        {
          bounds: { x: 72, y: 72, width: 450, height: 25 },
          baseline: 20,
          fragments: [
            {
              text: 'Visual Icon: ',
              bounds: { x: 0, y: 0, width: 80, height: 20 },
            },
            {
              text: '',
              drawing: shape,
              bounds: { x: 80, y: 0, width: 40, height: 20 },
            },
          ],
        },
      ],
    };

    renderer.renderPage(page, target);

    const hasText = target.calls.some((c) => c.method === 'fillText' && c.args[0] === 'Visual Icon: ');
    expect(hasText).toBe(true);

    const hasShapeStroke = target.calls.some((c) => c.method === 'stroke' && c.args[0] === '#008800');
    expect(hasShapeStroke).toBe(true);
  });
});
