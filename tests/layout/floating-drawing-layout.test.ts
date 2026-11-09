import { describe, expect, it } from 'bun:test';
import { StandardPageEngine } from '../../src/layout/page-engine.js';
import type { DocumentNode, DrawingShapeNode } from '../../src/types/ast.js';

const floatingShape = (overrides?: Partial<DrawingShapeNode>): DrawingShapeNode => ({
  type: 'drawing',
  name: 'KopBanner',
  widthPt: 381.1,
  heightPt: 71.45,
  commands: [
    { type: 'moveTo', points: [0, 0] },
    { type: 'lineTo', points: [381.1, 0] },
    { type: 'lineTo', points: [381.1, 71.45] },
    { type: 'lineTo', points: [0, 71.45] },
    { type: 'close', points: [] },
  ],
  fill: '#93B3D7',
  anchor: {
    horizontalFrom: 'column',
    horizontalOffsetPt: 6,
    verticalFrom: 'paragraph',
    verticalOffsetPt: -1,
  },
  ...overrides,
});

const makeDoc = (shape: DrawingShapeNode): DocumentNode => ({
  type: 'document',
  sections: [
    {
      type: 'section',
      properties: {
        pageSize: { width: 612, height: 792 },
        margins: { top: 72, right: 72, bottom: 72, left: 72 },
      },
      children: [
        {
          type: 'paragraph',
          children: [
            { type: 'run', text: '' },
            { type: 'run', text: '', drawing: shape },
            { type: 'run', text: '' },
          ],
        },
        {
          type: 'paragraph',
          children: [{ type: 'run', text: 'Kop text' }],
        },
      ],
    },
  ],
});

describe('Floating drawing layout', () => {
  const engine = new StandardPageEngine();

  it('excludes floating drawings from the inline flow', () => {
    const pages = engine.layoutDocument(makeDoc(floatingShape()));
    const line = pages[0]!.lines[0]!;
    // A 381pt banner must not widen the anchor line.
    expect(line.bounds.width).toBeLessThan(50);
  });

  it('positions the drawing fragment at the anchor offset', () => {
    const pages = engine.layoutDocument(makeDoc(floatingShape()));
    const line = pages[0]!.lines[0]!;
    const frag = line.fragments.find((f) => f.drawing !== undefined);
    expect(frag).toBeDefined();
    // Absolute target: x = margins.left(72) + 6, y = margins.top(72) + 0 - 1.
    expect(frag!.bounds.x).toBeCloseTo(6, 5);
    expect(frag!.bounds.y).toBeCloseTo(-1, 5);
    expect(frag!.bounds.width).toBeCloseTo(381.1, 5);
    expect(frag!.bounds.height).toBeCloseTo(71.45, 5);
  });

  it('keeps inline drawings in the flow', () => {
    const inline = floatingShape({ anchor: undefined });
    const pages = engine.layoutDocument(makeDoc(inline));
    const line = pages[0]!.lines[0]!;
    expect(line.bounds.width).toBeGreaterThan(300);
  });
});
