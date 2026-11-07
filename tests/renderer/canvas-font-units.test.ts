import { describe, expect, it } from 'bun:test';
import type { CanvasTarget } from '../../src/renderer/canvas/canvas-target.js';
import { StandardDrawPrimitives } from '../../src/renderer/canvas/draw-primitives.js';

/** Minimal CanvasTarget stub that records the font used for text. */
class FontRecordingTarget implements CanvasTarget {
  font = '';
  fillStyle: string | CanvasGradient | CanvasPattern = '#000';
  strokeStyle: string | CanvasGradient | CanvasPattern = '#000';
  lineWidth = 1;
  save(): void {}
  restore(): void {}
  translate(): void {}
  scale(): void {}
  fillText(): void {}
  fillRect(): void {}
  strokeRect(): void {}
}

describe('Canvas font units match layout advance units', () => {
  // Layout advances are measured in points and consumed in a uniform
  // point-space transform. The canvas font must therefore be specified
  // with the same number in px (see draw-primitives contract): a real
  // `pt` font renders glyphs 96/72 wider than the measured slots and
  // produces the overlapping text seen on canvas output.
  it('draws text with a px font sized by the pt number', () => {
    const target = new FontRecordingTarget();
    const primitives = new StandardDrawPrimitives();
    primitives.drawText(target, 'THE STORY', 0, 0, 10, { fontSizePt: 18 });
    expect(target.font).toContain('18px');
    expect(target.font).not.toContain('18pt');
  });

  it('draws leader dots with a px font sized by the pt number', () => {
    const target = new FontRecordingTarget();
    const primitives = new StandardDrawPrimitives();
    primitives.drawLeader(target, 'dot', 0, 0, 60, 10, { fontSizePt: 12 });
    expect(target.font).toContain('12px');
    expect(target.font).not.toContain('12pt');
  });
});
