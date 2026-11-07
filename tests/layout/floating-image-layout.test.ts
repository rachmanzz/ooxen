import { describe, expect, it } from 'bun:test';
import { StandardPageEngine } from '../../src/layout/page-engine.js';
import type { DocumentNode, ImageNode } from '../../src/types/ast.js';

const floatingImage = (overrides?: Partial<ImageNode>): ImageNode => ({
  type: 'image',
  name: 'Float.png',
  widthPt: 224,
  heightPt: 95,
  anchor: {
    horizontalFrom: 'column',
    horizontalOffsetPt: 100,
    verticalFrom: 'paragraph',
    verticalOffsetPt: 10,
  },
  ...overrides,
});

const makeDoc = (image: ImageNode): DocumentNode => ({
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
            { type: 'run', text: 'Hi ' },
            { type: 'run', text: '', image },
            { type: 'run', text: 'there' },
          ],
        },
      ],
    },
  ],
});

describe('Floating image layout', () => {
  const engine = new StandardPageEngine();

  it('excludes floating images from the inline flow', () => {
    const pages = engine.layoutDocument(makeDoc(floatingImage()));
    const line = pages[0]!.lines[0]!;
    // Text "Hi there" at ~11pt is far narrower than 224pt image + text.
    expect(line.bounds.width).toBeLessThan(150);
  });

  it('positions the fragment at the anchor offset', () => {
    const pages = engine.layoutDocument(makeDoc(floatingImage()));
    const line = pages[0]!.lines[0]!;
    const frag = line.fragments.find((f) => f.image !== undefined);
    expect(frag).toBeDefined();
    // Absolute target: x = margins.left(72) + 100, y = margins.top(72) + 0 + 10.
    // Fragment bounds are relative to the line origin (72, 72).
    expect(frag!.bounds.x).toBeCloseTo(100, 5);
    expect(frag!.bounds.y).toBeCloseTo(10, 5);
    expect(frag!.bounds.width).toBe(224);
    expect(frag!.bounds.height).toBe(95);
  });

  it('keeps inline images in the flow', () => {
    const inline: ImageNode = { type: 'image', name: 'In.png', widthPt: 224, heightPt: 95 };
    const pages = engine.layoutDocument(makeDoc(inline));
    const line = pages[0]!.lines[0]!;
    expect(line.bounds.width).toBeGreaterThan(224);
    const frag = line.fragments.find((f) => f.image !== undefined);
    expect(frag!.bounds.x).toBeGreaterThan(0);
  });
});

describe('Align-based anchor resolution (F-ANCHOR)', () => {
  const engine = new StandardPageEngine();

  const fragOf = (image: ImageNode) => {
    const pages = engine.layoutDocument(makeDoc(image));
    const line = pages[0]!.lines[0]!;
    const frag = line.fragments.find((f) => f.image !== undefined);
    expect(frag).toBeDefined();
    return { frag: frag!, line };
  };

  it('centers a column-relative image', () => {
    const { frag, line } = fragOf(
      floatingImage({
        anchor: { horizontalFrom: 'column', horizontalOffsetPt: 0, horizontalAlign: 'center', verticalFrom: 'paragraph', verticalOffsetPt: 10 },
      }),
    );
    // Column width 468, image 224: absolute x = 72 + 122.
    expect(line.bounds.x + frag.bounds.x).toBeCloseTo(72 + (468 - 224) / 2, 5);
  });

  it('right-aligns a page-relative image', () => {
    const { frag, line } = fragOf(
      floatingImage({
        anchor: { horizontalFrom: 'page', horizontalOffsetPt: 0, horizontalAlign: 'right', verticalFrom: 'paragraph', verticalOffsetPt: 10 },
      }),
    );
    expect(line.bounds.x + frag.bounds.x).toBeCloseTo(612 - 224, 5);
  });

  it('pins inside to the reference edge on a recto page', () => {
    const { frag, line } = fragOf(
      floatingImage({
        anchor: { horizontalFrom: 'column', horizontalOffsetPt: 0, horizontalAlign: 'inside', verticalFrom: 'paragraph', verticalOffsetPt: 10 },
      }),
    );
    expect(line.bounds.x + frag.bounds.x).toBeCloseTo(72, 5);
  });

  it('centers a page-relative image vertically', () => {
    const { frag, line } = fragOf(
      floatingImage({
        anchor: { horizontalFrom: 'column', horizontalOffsetPt: 100, verticalFrom: 'page', verticalOffsetPt: 0, verticalAlign: 'center' },
      }),
    );
    expect(line.bounds.y + frag.bounds.y).toBeCloseTo((792 - 95) / 2, 5);
  });

  it('pins a paragraph-relative vertical align to the paragraph top', () => {
    const { frag, line } = fragOf(
      floatingImage({
        anchor: { horizontalFrom: 'column', horizontalOffsetPt: 100, verticalFrom: 'paragraph', verticalOffsetPt: 0, verticalAlign: 'bottom' },
      }),
    );
    // Documented approximation: paragraph height is unknown mid-layout.
    expect(line.bounds.y + frag.bounds.y).toBeCloseTo(72, 5);
  });
});
