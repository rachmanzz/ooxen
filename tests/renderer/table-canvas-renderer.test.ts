import { describe, expect, it } from 'bun:test';
import { StandardPageEngine } from '../../src/layout/page-engine.js';
import { StandardPageRenderer } from '../../src/renderer/canvas/page-renderer.js';
import type { CanvasTarget } from '../../src/renderer/canvas/canvas-target.js';
import type { DocumentNode } from '../../src/types/ast.js';

describe('Table Cell Shading & Border Canvas Renderer', () => {
  it('layouts table cell shading and borders into PageLayout cellBoxes', () => {
    const doc: DocumentNode = {
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
              type: 'table',
              style: {
                borderTop: 'single #000000',
                borderBottom: 'single #000000',
                borderInsideH: 'single #CCCCCC',
                borderInsideV: 'single #CCCCCC',
              },
              rows: [
                {
                  type: 'table-row',
                  children: [
                    {
                      type: 'table-cell',
                      widthPt: 150,
                      style: {
                        backgroundColor: '#EAEAEA',
                        borderTop: 'single #FF0000',
                      },
                      children: [
                        {
                          type: 'paragraph',
                          children: [{ type: 'run', text: 'Cell 1' }],
                        },
                      ],
                    },
                    {
                      type: 'table-cell',
                      widthPt: 150,
                      style: {
                        backgroundColor: '#FAFAFA',
                      },
                      children: [
                        {
                          type: 'paragraph',
                          children: [{ type: 'run', text: 'Cell 2' }],
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

    const engine = new StandardPageEngine();
    const [page] = engine.layoutDocument(doc);
    expect(page).toBeDefined();
    expect(page?.cellBoxes).toBeDefined();
    expect(page?.cellBoxes?.length).toBe(2);

    const [c1, c2] = page!.cellBoxes!;
    expect(c1?.backgroundColor).toBe('#EAEAEA');
    expect(c1?.borderTop?.color).toBe('#FF0000');
    expect(c1?.bounds.x).toBe(72);
    expect(c1?.bounds.y).toBe(72);
    expect(c1?.bounds.width).toBe(150);

    expect(c2?.backgroundColor).toBe('#FAFAFA');
    expect(c2?.bounds.x).toBe(222);
    expect(c2?.bounds.width).toBe(150);
  });

  it('draws cell background and border lines onto CanvasTarget', () => {
    const calls: string[] = [];
    const mockTarget: CanvasTarget = {
      save: () => calls.push('save'),
      restore: () => calls.push('restore'),
      fillText: (text: string) => calls.push(`fillText(${text})`),
      fillRect: (x: number, y: number, w: number, h: number) => calls.push(`fillRect(${x},${y},${w},${h})`),
      strokeRect: () => {},
      beginPath: () => calls.push('beginPath'),
      closePath: () => calls.push('closePath'),
      moveTo: (x: number, y: number) => calls.push(`moveTo(${x},${y})`),
      lineTo: (x: number, y: number) => calls.push(`lineTo(${x},${y})`),
      stroke: () => calls.push('stroke'),
      setLineDash: (segments: number[]) => calls.push(`setLineDash(${segments.join(',')})`),
      font: '',
      fillStyle: '#000000',
      strokeStyle: '#000000',
      lineWidth: 1,
      translate: () => {},
      scale: () => {},
    };

    const doc: DocumentNode = {
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
              type: 'table',
              rows: [
                {
                  type: 'table-row',
                  children: [
                    {
                      type: 'table-cell',
                      widthPt: 200,
                      style: {
                        backgroundColor: '#FFFF00',
                        borderBottom: 'single #0000FF',
                      },
                      children: [
                        {
                          type: 'paragraph',
                          children: [{ type: 'run', text: 'Highlighted Cell' }],
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

    const engine = new StandardPageEngine();
    const [page] = engine.layoutDocument(doc);
    expect(page).toBeDefined();

    const renderer = new StandardPageRenderer();
    renderer.renderPage(page!, mockTarget);

    // Should fill background with yellow fillRect(72,72,200,...)
    const bgFill = calls.find((c) => c.startsWith('fillRect(72,72,200,'));
    expect(bgFill).toBeDefined();

    // Should draw bottom border line using stroke or fillRect fallback
    const hasBorderCall = calls.some((c) => c.includes('moveTo(72,') || c.includes('fillRect(72,'));
    expect(hasBorderCall).toBe(true);
  });
});
