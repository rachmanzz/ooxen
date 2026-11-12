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

  it('resolves floating drawings inside headers to their anchor (F-HDRFLOAT)', () => {
    const doc: DocumentNode = {
      type: 'document',
      sections: [
        {
          type: 'section',
          properties: {
            pageSize: { width: 612, height: 792 },
            margins: { top: 72, right: 72, bottom: 72, left: 72 },
          },
          headers: {
            default: {
              type: 'header',
              kind: 'default',
              children: [
                {
                  type: 'paragraph',
                  children: [
                    { type: 'run', text: 'H' },
                    { type: 'run', text: '', drawing: floatingShape() },
                  ],
                },
              ],
            },
          },
          children: [
            {
              type: 'paragraph',
              children: [{ type: 'run', text: 'Body' }],
            },
          ],
        },
      ],
    };
    const pages = engine.layoutDocument(doc);
    const line = pages[0]!.headerLines![0]!;
    const frag = line.fragments.find((f) => f.drawing !== undefined);
    expect(frag).toBeDefined();
    // Same anchor math as body floats: x = column edge + 6, y = para top - 1.
    expect(frag!.bounds.x).toBeCloseTo(6, 5);
    expect(frag!.bounds.y).toBeCloseTo(-1, 5);
  });

  it('lays floating shape text inside the shape, not as flow lines (F-TBXFLOAT)', () => {
    const shape = floatingShape({
      textbox: [
        {
          type: 'paragraph',
          style: { alignment: 'center' },
          children: [{ type: 'run', text: 'Jurnal Dedikasi Pendidikan', style: { fontSizePt: 14, bold: true } }],
        },
        {
          type: 'paragraph',
          children: [{ type: 'run', text: 'ISSN 2548-8848', style: { fontSizePt: 8.5 } }],
        },
      ],
    });
    const doc = makeDoc(shape);
    const pages = engine.layoutDocument(doc);
    // Anchor paragraph + following paragraph only: no sibling lines for the
    // two textbox paragraphs.
    expect(pages[0]!.lines.length).toBe(2);
    const frag = pages[0]!.lines[0]!.fragments.find((f) => f.drawing !== undefined);
    expect(frag).toBeDefined();
    const shapeText = frag!.shapeText;
    expect(shapeText).toBeDefined();
    expect(shapeText!.lines.length).toBe(2);
    const text = shapeText!.lines.map((l) => l.fragments.map((f) => f.text).join('').trim()).join(' / ');
    expect(text).toContain('Jurnal Dedikasi Pendidikan');
    expect(text).toContain('ISSN 2548-8848');
  });

  it('lays floating shape text inside the frame when the shape sits in a table cell (F-TBXFLOAT)', () => {
    const shape = floatingShape({
      widthPt: 150,
      heightPt: 40,
      textbox: [{ type: 'paragraph', children: [{ type: 'run', text: 'Cell banner', style: { fontSizePt: 10 } }] }],
    });
    const doc: DocumentNode = {
      type: 'document',
      sections: [
        {
          type: 'section',
          properties: { pageSize: { width: 612, height: 792 }, margins: { top: 72, right: 72, bottom: 72, left: 72 } },
          children: [
            {
              type: 'table',
              columnWidthsPt: [200, 200],
              rows: [
                {
                  type: 'table-row',
                  children: [
                    { type: 'table-cell', children: [{ type: 'paragraph', children: [{ type: 'run', text: '', drawing: shape }] }] },
                    { type: 'table-cell', children: [{ type: 'paragraph', children: [{ type: 'run', text: 'B' }] }] },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const pages = engine.layoutDocument(doc);
    const frag = pages[0]!.lines.flatMap((l) => l.fragments).find((f) => f.drawing !== undefined);
    expect(frag).toBeDefined();
    expect(frag!.bounds.width).toBeCloseTo(150, 5);
    const text = frag!.shapeText?.lines.map((l) => l.fragments.map((f) => f.text).join('')).join('');
    expect(text).toContain('Cell banner');
  });

  it('does not lay out textbox text for inline block drawings, matching the HTML renderer (F-TBXFLOAT)', () => {
    const inlineShape = floatingShape({
      anchor: undefined,
      textbox: [{ type: 'paragraph', children: [{ type: 'run', text: 'Drained already' }] }],
    });
    const doc: DocumentNode = {
      type: 'document',
      sections: [
        {
          type: 'section',
          properties: { pageSize: { width: 612, height: 792 }, margins: { top: 72, right: 72, bottom: 72, left: 72 } },
          children: [inlineShape],
        },
      ],
    };
    const pages = engine.layoutDocument(doc);
    const frag = pages[0]!.lines.flatMap((l) => l.fragments).find((f) => f.drawing !== undefined);
    expect(frag).toBeDefined();
    expect(frag!.shapeText).toBeUndefined();
  });
});
