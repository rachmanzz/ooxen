import { describe, expect, it } from 'bun:test';
import type { PageLayout } from '../../src/layout/page-engine.js';
import type { CanvasTarget } from '../../src/renderer/canvas/canvas-target.js';
import { StandardPageRenderer } from '../../src/renderer/canvas/page-renderer.js';

interface DrawCall {
  type: 'fillText' | 'fillRect' | 'strokeRect';
  text?: string;
  x: number;
  y: number;
  w?: number;
  h?: number;
  font?: string;
  fillStyle?: string;
}

class TestCanvasTarget implements CanvasTarget {
  font: string = '';
  fillStyle: string = '#000000';
  strokeStyle: string = '#000000';
  lineWidth: number = 1;
  calls: DrawCall[] = [];

  save(): void {}
  restore(): void {}
  translate(): void {}
  scale(): void {}

  fillText(text: string, x: number, y: number): void {
    this.calls.push({
      type: 'fillText',
      text,
      x,
      y,
      font: this.font,
      fillStyle: this.fillStyle,
    });
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    this.calls.push({
      type: 'fillRect',
      x,
      y,
      w,
      h,
      fillStyle: this.fillStyle,
    });
  }

  strokeRect(x: number, y: number, w: number, h: number): void {
    this.calls.push({
      type: 'strokeRect',
      x,
      y,
      w,
      h,
    });
  }
}

describe('Canvas Page Renderer', () => {
  const renderer = new StandardPageRenderer();

  it('should render page paper and text fragments to canvas target', () => {
    const page: PageLayout = {
      pageIndex: 0,
      pageNumber: 1,
      orientation: 'portrait',
      size: { width: 612, height: 792 },
      margins: { top: 72, right: 72, bottom: 72, left: 72 },
      lines: [
        {
          bounds: { x: 72, y: 72, width: 200, height: 16 },
          baseline: 12,
          fragments: [
            {
              text: 'Hello',
              style: { bold: true, fontSizePt: 14, color: '#FF0000' },
              bounds: { x: 0, y: 0, width: 40, height: 16 },
            },
            {
              text: 'World',
              style: { italic: true, fontSizePt: 14, color: '#0000FF' },
              bounds: { x: 45, y: 0, width: 40, height: 16 },
            },
          ],
        },
      ],
    };

    const target = new TestCanvasTarget();
    renderer.renderPage(page, target);

    // 1. First call should be drawing paper background
    expect(target.calls.length).toBeGreaterThanOrEqual(3);
    const bgCall = target.calls[0];
    expect(bgCall?.type).toBe('fillRect');
    expect(bgCall?.w).toBe(612);
    expect(bgCall?.h).toBe(792);

    // 2. Text draw calls
    const textCalls = target.calls.filter((c) => c.type === 'fillText');
    expect(textCalls.length).toBe(2);

    expect(textCalls[0]?.text).toBe('Hello');
    expect(textCalls[0]?.x).toBe(72); // margin left + frag bounds
    expect(textCalls[0]?.y).toBe(84); // 72 + baseline 12
    expect(textCalls[0]?.fillStyle).toBe('#FF0000');
    expect(textCalls[0]?.font).toContain('bold');

    expect(textCalls[1]?.text).toBe('World');
    expect(textCalls[1]?.x).toBe(117); // 72 + 45
    expect(textCalls[1]?.fillStyle).toBe('#0000FF');
    expect(textCalls[1]?.font).toContain('italic');
  });
});
