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

  it('centres an align-keyword float inside its table cell, not outside it (F-TBXFLOAT)', () => {
    const shape = floatingShape({
      widthPt: 100,
      heightPt: 20,
      anchor: { horizontalFrom: 'column', horizontalAlign: 'center', horizontalOffsetPt: 0, verticalFrom: 'paragraph', verticalOffsetPt: 0 },
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
    const line = pages[0]!.lines.find((l) => l.fragments.some((f) => f.drawing !== undefined))!;
    const frag = line.fragments.find((f) => f.drawing !== undefined)!;
    const pageX = line.bounds.x + frag.bounds.x;
    // Cell spans 72..272 with 4pt padding: a 100pt shape centred in the
    // 192pt content box starts at 72 + 4 + 46. Without a column width the
    // centre keyword resolved against 0 and pushed the shape 50pt left.
    expect(pageX).toBeCloseTo(122, 1);
    expect(pageX).toBeGreaterThanOrEqual(72);
    expect(pageX + frag.bounds.width).toBeLessThanOrEqual(272);
  });

  it('keeps a page-relative vertical keyword inside its table cell (F-TBXFLOAT)', () => {
    const shape = floatingShape({
      widthPt: 100,
      heightPt: 20,
      anchor: { horizontalFrom: 'column', horizontalOffsetPt: 0, verticalFrom: 'page', verticalAlign: 'bottom', verticalOffsetPt: 0 },
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
              columnWidthsPt: [200],
              rows: [
                {
                  type: 'table-row',
                  children: [{ type: 'table-cell', children: [{ type: 'paragraph', children: [{ type: 'run', text: '', drawing: shape }] }] }],
                },
              ],
            },
          ],
        },
      ],
    };
    const pages = engine.layoutDocument(doc);
    expect(pages).toHaveLength(1);
    const line = pages[0]!.lines.find((l) => l.fragments.some((f) => f.drawing !== undefined))!;
    const frag = line.fragments.find((f) => f.drawing !== undefined)!;
    const pageY = line.bounds.y + frag.bounds.y;
    // The cell has no measurable height while it is being filled, so the
    // keyword pins to the cell top (72pt margin + 2pt padding), never to
    // the host page's bottom edge a page below.
    expect(pageY).toBeGreaterThanOrEqual(72);
    expect(pageY).toBeLessThan(100);
  });

  it('resolves a block-level floating drawing at its anchor and takes one empty line of flow (F-HTMLFLOAT)', () => {
    const shape = floatingShape({
      widthPt: 120,
      heightPt: 60,
      anchor: { horizontalFrom: 'column', horizontalOffsetPt: 24, verticalFrom: 'paragraph', verticalOffsetPt: 6 },
    });
    const doc: DocumentNode = {
      type: 'document',
      sections: [
        {
          type: 'section',
          properties: { pageSize: { width: 612, height: 792 }, margins: { top: 72, right: 72, bottom: 72, left: 72 } },
          children: [shape, { type: 'paragraph', children: [{ type: 'run', text: 'After' }] }],
        },
      ],
    };
    const pages = engine.layoutDocument(doc);
    const lines = pages[0]!.lines;
    const shapeLine = lines.find((l) => l.fragments.some((f) => f.drawing !== undefined))!;
    const frag = shapeLine.fragments.find((f) => f.drawing !== undefined)!;
    expect(shapeLine.bounds.x + frag.bounds.x).toBeCloseTo(72 + 24, 5);
    expect(shapeLine.bounds.y + frag.bounds.y).toBeCloseTo(72 + 6, 5);
    // The host paragraph is empty: the next block starts within one line,
    // not 60pt further down as an in-flow block would push it.
    const after = lines.find((l) => l.fragments.some((f) => f.text === 'After'))!;
    expect(after.bounds.y).toBeGreaterThanOrEqual(72);
    expect(after.bounds.y).toBeLessThan(72 + 30);
  });

  it('lets layoutInCell="0" floats in a cell reach the page edge (F-TBXFLOAT)', () => {
    const cellDoc = (layoutInCell: boolean | undefined): DocumentNode => ({
      type: 'document',
      sections: [
        {
          type: 'section',
          properties: { pageSize: { width: 612, height: 792 }, margins: { top: 72, right: 72, bottom: 72, left: 72 } },
          children: [
            {
              type: 'table',
              columnWidthsPt: [200],
              rows: [
                {
                  type: 'table-row',
                  children: [
                    {
                      type: 'table-cell',
                      children: [
                        {
                          type: 'paragraph',
                          children: [
                            {
                              type: 'run',
                              text: '',
                              drawing: floatingShape({
                                widthPt: 100,
                                heightPt: 20,
                                anchor: { horizontalFrom: 'page', horizontalAlign: 'right', horizontalOffsetPt: 0, verticalFrom: 'paragraph', verticalOffsetPt: 0, layoutInCell },
                              }),
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    const pageX = (doc: DocumentNode): number => {
      const line = engine.layoutDocument(doc)[0]!.lines.find((l) => l.fragments.some((f) => f.drawing !== undefined))!;
      const frag = line.fragments.find((f) => f.drawing !== undefined)!;
      return line.bounds.x + frag.bounds.x;
    };
    // Default (in cell): right edge of the 192pt content box at 72 + 4.
    expect(pageX(cellDoc(undefined))).toBeCloseTo(72 + 4 + 192 - 100, 1);
    // layoutInCell="0": right edge of the 612pt page.
    expect(pageX(cellDoc(false))).toBeCloseTo(612 - 100, 1);
  });

  it('re-resolves layoutInCell="0" floats after the row moves to the next page (F-TBXFLOAT)', () => {
    const filler = Array.from({ length: 49 }, () => ({
      type: 'paragraph' as const,
      children: [{ type: 'run' as const, text: 'filler line' }],
    }));
    const doc: DocumentNode = {
      type: 'document',
      sections: [
        {
          type: 'section',
          properties: { pageSize: { width: 612, height: 792 }, margins: { top: 72, right: 72, bottom: 72, left: 72 } },
          children: [
            ...filler,
            {
              type: 'table',
              columnWidthsPt: [200],
              rows: [
                {
                  type: 'table-row',
                  heightPt: 100,
                  children: [
                    {
                      type: 'table-cell',
                      children: [
                        {
                          type: 'paragraph',
                          children: [
                            {
                              type: 'run',
                              text: '',
                              drawing: floatingShape({
                                widthPt: 100,
                                heightPt: 20,
                                anchor: { horizontalFrom: 'page', horizontalOffsetPt: 0, verticalFrom: 'page', verticalOffsetPt: 10, layoutInCell: false },
                              }),
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const pages = engine.layoutDocument(doc);
    const placed = pages
      .map((page, pageIndex) => ({ pageIndex, line: page.lines.find((l) => l.fragments.some((f) => f.drawing !== undefined)) }))
      .filter((p) => p.line !== undefined);
    expect(placed).toHaveLength(1);
    // The row did not fit page 1; the float follows it and resolves
    // against the page it actually lands on: page origin + 10pt.
    expect(placed[0]!.pageIndex).toBe(1);
    const line = placed[0]!.line!;
    const frag = line.fragments.find((f) => f.drawing !== undefined)!;
    expect(line.bounds.x + frag.bounds.x).toBeCloseTo(0, 1);
    expect(line.bounds.y + frag.bounds.y).toBeCloseTo(10, 1);
  });

  it('folds vertical cell alignment into layoutInCell="0" float resolution (F-TBXFLOAT)', () => {
    const doc: DocumentNode = {
      type: 'document',
      sections: [
        {
          type: 'section',
          properties: { pageSize: { width: 612, height: 792 }, margins: { top: 72, right: 72, bottom: 72, left: 72 } },
          children: [
            {
              type: 'table',
              columnWidthsPt: [200],
              rows: [
                {
                  type: 'table-row',
                  heightPt: 200,
                  children: [
                    {
                      type: 'table-cell',
                      style: { verticalAlign: 'bottom' },
                      children: [
                        {
                          type: 'paragraph',
                          children: [
                            {
                              type: 'run',
                              text: '',
                              drawing: floatingShape({
                                widthPt: 100,
                                heightPt: 20,
                                anchor: { horizontalFrom: 'page', horizontalOffsetPt: 0, verticalFrom: 'page', verticalOffsetPt: 10, layoutInCell: false },
                              }),
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const page = engine.layoutDocument(doc)[0]!;
    const line = page.lines.find((l) => l.fragments.some((f) => f.drawing !== undefined))!;
    const frag = line.fragments.find((f) => f.drawing !== undefined)!;
    // Bottom alignment pushes the host line far down the 200pt row...
    expect(line.bounds.y).toBeGreaterThan(72 + 150);
    // ...but a page-relative float still sits 10pt from the page top.
    expect(line.bounds.y + frag.bounds.y).toBeCloseTo(10, 1);
  });

  it('chains layoutInCell="0" resolution through nested tables to the page (F-TBXFLOAT)', () => {
    const doc: DocumentNode = {
      type: 'document',
      sections: [
        {
          type: 'section',
          properties: { pageSize: { width: 612, height: 792 }, margins: { top: 72, right: 72, bottom: 72, left: 72 } },
          children: [
            {
              type: 'table',
              columnWidthsPt: [300],
              rows: [
                {
                  type: 'table-row',
                  children: [
                    {
                      type: 'table-cell',
                      children: [
                        { type: 'paragraph', children: [{ type: 'run', text: 'outer' }] },
                        {
                          type: 'table',
                          columnWidthsPt: [200],
                          rows: [
                            {
                              type: 'table-row',
                              children: [
                                {
                                  type: 'table-cell',
                                  children: [
                                    {
                                      type: 'paragraph',
                                      children: [
                                        {
                                          type: 'run',
                                          text: '',
                                          drawing: floatingShape({
                                            widthPt: 100,
                                            heightPt: 20,
                                            anchor: { horizontalFrom: 'page', horizontalAlign: 'right', horizontalOffsetPt: 0, verticalFrom: 'page', verticalOffsetPt: 10, layoutInCell: false },
                                          }),
                                        },
                                      ],
                                    },
                                  ],
                                },
                              ],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const page = engine.layoutDocument(doc)[0]!;
    const line = page.lines.find((l) => l.fragments.some((f) => f.drawing !== undefined))!;
    const frag = line.fragments.find((f) => f.drawing !== undefined)!;
    expect(line.bounds.x + frag.bounds.x).toBeCloseTo(612 - 100, 1);
    expect(line.bounds.y + frag.bounds.y).toBeCloseTo(10, 1);
  });

  it('hosts block-level floating drawings in headers like the body does (F-HTMLFLOAT)', () => {
    const doc: DocumentNode = {
      type: 'document',
      sections: [
        {
          type: 'section',
          properties: { pageSize: { width: 612, height: 792 }, margins: { top: 72, right: 72, bottom: 72, left: 72 } },
          headers: {
            default: {
              type: 'header',
              kind: 'default',
              children: [floatingShape()],
            },
          },
          children: [{ type: 'paragraph', children: [{ type: 'run', text: 'Body' }] }],
        },
      ],
    };
    const pages = engine.layoutDocument(doc);
    const line = pages[0]!.headerLines![0];
    expect(line).toBeDefined();
    const frag = line!.fragments.find((f) => f.drawing !== undefined);
    expect(frag).toBeDefined();
    // Same anchor math as the inline header float above.
    expect(frag!.bounds.x).toBeCloseTo(6, 5);
    expect(frag!.bounds.y).toBeCloseTo(-1, 5);
  });

  it('resolves column references of layoutInCell="0" floats against the host column, not the cell (F-TBXFLOAT)', () => {
    const cellDoc = (layoutInCell: boolean | undefined): DocumentNode => ({
      type: 'document',
      sections: [
        {
          type: 'section',
          properties: { pageSize: { width: 612, height: 792 }, margins: { top: 72, right: 72, bottom: 72, left: 72 } },
          children: [
            {
              type: 'table',
              columnWidthsPt: [200],
              rows: [
                {
                  type: 'table-row',
                  children: [
                    {
                      type: 'table-cell',
                      children: [
                        {
                          type: 'paragraph',
                          children: [
                            {
                              type: 'run',
                              text: '',
                              drawing: floatingShape({
                                widthPt: 100,
                                heightPt: 20,
                                textbox: [{ type: 'paragraph', children: [{ type: 'run', text: 'Logo caption' }] }],
                                anchor: { horizontalFrom: 'column', horizontalAlign: 'right', horizontalOffsetPt: 0, verticalFrom: 'paragraph', verticalOffsetPt: 0, layoutInCell },
                              }),
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    const placed = (doc: DocumentNode) => {
      const line = engine.layoutDocument(doc)[0]!.lines.find((l) => l.fragments.some((f) => f.drawing !== undefined))!;
      const frag = line.fragments.find((f) => f.drawing !== undefined)!;
      return { x: line.bounds.x + frag.bounds.x, frag };
    };
    // In the cell: right edge of the 192pt content box at 72 + 4.
    expect(placed(cellDoc(undefined)).x).toBeCloseTo(72 + 4 + 192 - 100, 1);
    // Outside the cell: right edge of the 468pt text column at 72.
    const outside = placed(cellDoc(false));
    expect(outside.x).toBeCloseTo(72 + 468 - 100, 1);
    // The deferred placement still lays the shape text in the frame.
    expect(outside.frag.shapeText?.lines.length).toBe(1);
  });
});
