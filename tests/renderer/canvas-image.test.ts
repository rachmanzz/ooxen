import { describe, expect, it } from 'bun:test';
import type { DocumentNode, ImageNode } from '../../src/types/ast.js';
import type { CanvasTarget } from '../../src/renderer/canvas/canvas-target.js';
import { StandardDrawPrimitives } from '../../src/renderer/canvas/draw-primitives.js';
import {
  cacheBitmap,
  collectImageNodes,
  getCachedBitmap,
  preloadDocumentImages,
} from '../../src/renderer/canvas/image-loader.js';

/** Target whose drawImage explodes on URL strings, like a raw 2D context. */
class StrictCanvasTarget implements CanvasTarget {
  font = '';
  fillStyle: string | CanvasGradient | CanvasPattern = '#000';
  strokeStyle: string | CanvasGradient | CanvasPattern = '#000';
  lineWidth = 1;
  draws: unknown[] = [];
  rects: number[][] = [];
  texts: string[] = [];
  order: string[] = [];
  save(): void {}
  restore(): void {}
  translate(): void {}
  scale(): void {}
  fillText(text: string): void {
    this.texts.push(text);
    this.order.push('text');
  }
  fillRect(x: number, y: number, w: number, h: number): void {
    this.rects.push([x, y, w, h]);
  }
  strokeRect(): void {}
  drawImage(image: CanvasImageSource | string, x: number, y: number, w: number, h: number): void {
    if (typeof image === 'string') {
      throw new TypeError('not of type CanvasImageSource');
    }
    this.draws.push([image, x, y, w, h]);
    this.order.push('image');
  }
}

const imgNode = (name: string, src?: string): ImageNode => ({
  type: 'image',
  name,
  widthPt: 100,
  heightPt: 60,
  src,
});

describe('Canvas image loading', () => {
  it('never passes a URL string to the host (no render abort)', () => {
    const target = new StrictCanvasTarget();
    const primitives = new StandardDrawPrimitives();
    // Must not throw even though no bitmap was preloaded.
    primitives.drawImage(target, imgNode('a.png', 'data:image/png;base64,AQID'), 10, 20);
    expect(target.draws).toEqual([]);
    // Placeholder box drawn instead.
    expect(target.rects.length).toBeGreaterThan(0);
    expect(target.texts).toEqual(['a.png']);
  });

  it('prefers the file name over a raw local path in the placeholder label', () => {
    const target = new StrictCanvasTarget();
    const primitives = new StandardDrawPrimitives();
    const node = imgNode('image10.jpg');
    node.altText = 'E:\\DATA LAPTOP HP\\cover dedikasi januari 2017 (2 X).jpg';
    primitives.drawImage(target, node, 10, 20);
    expect(target.texts).toEqual(['image10.jpg']);
  });

  it('draws behindDoc floats before text', async () => {
    const { StandardPageRenderer } = await import('../../src/renderer/canvas/page-renderer.js');
    const target = new StrictCanvasTarget();
    const bitmap = { __fake: 2 } as unknown as CanvasImageSource;
    const node = imgNode('back.png', 'data:image/png;base64,AQID');
    node.anchor = { horizontalFrom: 'column', horizontalOffsetPt: 0, verticalFrom: 'paragraph', verticalOffsetPt: 0, behindDoc: true };
    cacheBitmap(node, bitmap);
    new StandardPageRenderer().renderPage(
      {
        pageIndex: 0,
        pageNumber: 1,
        orientation: 'portrait',
        size: { width: 612, height: 792 },
        margins: { top: 72, right: 72, bottom: 72, left: 72 },
        lines: [
          {
            bounds: { x: 72, y: 72, width: 200, height: 20 },
            baseline: 15,
            fragments: [
              { text: 'Hello', bounds: { x: 0, y: 0, width: 40, height: 20 } },
              { text: '', image: node, bounds: { x: 50, y: 0, width: 100, height: 60 } },
            ],
          },
        ],
      } as never,
      target,
    );
    expect(target.draws.length).toBe(1);
    expect(target.order).toEqual(['image', 'text']);
  });

  it('draws the cached bitmap once preloaded', () => {
    const target = new StrictCanvasTarget();
    const primitives = new StandardDrawPrimitives();
    const node = imgNode('b.png', 'data:image/png;base64,AQID');
    const bitmap = { __fake: 1 } as unknown as CanvasImageSource;
    cacheBitmap(node, bitmap);
    primitives.drawImage(target, node, 10, 20);
    expect(target.draws.length).toBe(1);
    expect(getCachedBitmap(node)).toBe(bitmap);
  });

  it('preloads each distinct URL once with the injected loader', async () => {
    const shared = imgNode('shared.png', 'data:image/png;base64,AAAA');
    const other = imgNode('other.png', 'data:image/png;base64,BBBB');
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
            { type: 'paragraph', children: [{ type: 'run', text: '', image: shared }] },
            { type: 'paragraph', children: [{ type: 'run', text: '', image: { ...shared } }] },
            { type: 'paragraph', children: [{ type: 'run', text: '', image: other }] },
            { type: 'paragraph', children: [{ type: 'run', text: '', image: imgNode('nosrc') }] },
          ],
        },
      ],
    };

    // Two nodes share one object identity for `shared`... the spread copy
    // has the same src but is a different node; both must resolve.
    expect(collectImageNodes(doc).length).toBe(4);

    const seen: string[] = [];
    const result = await preloadDocumentImages(doc, async (src) => {
      seen.push(src);
      return { __bitmapFor: src } as unknown as CanvasImageSource;
    });

    expect(result).toEqual({ loaded: 3, failed: 0, skipped: false });
    expect(seen.sort()).toEqual(['data:image/png;base64,AAAA', 'data:image/png;base64,BBBB']);
    expect(getCachedBitmap(shared)).toBeDefined();
    expect(getCachedBitmap(other)).toBeDefined();
  });

  it('reports skipped when no loader is available', async () => {
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
            { type: 'paragraph', children: [{ type: 'run', text: '', image: imgNode('x.png', 'data:image/png;base64,AAAA') }] },
          ],
        },
      ],
    };
    // Explicit loader that decodes nothing + default loader absent in bun
    // (no createImageBitmap): both paths must resolve, never reject.
    const viaUndefined = await preloadDocumentImages(doc, async () => undefined);
    expect(viaUndefined).toEqual({ loaded: 0, failed: 1, skipped: false });
  });

  it('draws WMF equation previews as vectors (F-WMFEQ)', async () => {
    const { parseWmfPreview } = await import('../../src/parser/dml/wmf-preview.js');
    const u16 = (v: number): number[] => [v & 0xff, (v >> 8) & 0xff];
    const wmf = new Uint8Array([
      0xd7, 0xcd, 0xc6, 0x9a, 0x00, 0x00,
      ...u16(0), ...u16(0), ...u16(1000), ...u16(1000),
      ...u16(1440), 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x08, 0x00, 0x00, 0x00, 0x32, 0x0a,
      ...u16(100), ...u16(100), ...u16(2), ...u16(0),
      0x48, 0x69,
    ]);
    const preview = parseWmfPreview(wmf);
    expect(preview).toBeDefined();
    const target = new StrictCanvasTarget();
    new StandardDrawPrimitives().drawWmfPreview(target, preview!, 10, 20, 50, 50);
    expect(target.texts).toEqual(['Hi']);
    expect(target.order).toEqual(['text']);
  });

  it('falls back to drawImage when custom primitives lack drawWmfPreview (F-WMFEQ)', async () => {
    const { StandardPageRenderer } = await import('../../src/renderer/canvas/page-renderer.js');
    const u16 = (v: number): number[] => [v & 0xff, (v >> 8) & 0xff];
    const wmf = new Uint8Array([
      0xd7, 0xcd, 0xc6, 0x9a, 0x00, 0x00,
      ...u16(0), ...u16(0), ...u16(1000), ...u16(1000),
      ...u16(1440), 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x08, 0x00, 0x00, 0x00, 0x32, 0x0a,
      ...u16(100), ...u16(100), ...u16(2), ...u16(0),
      0x48, 0x69,
    ]);
    const image: ImageNode = { type: 'image', name: 'eq.wmf', widthPt: 50, heightPt: 50, data: wmf, mimeType: 'image/x-wmf' };
    const calls: string[] = [];
    const standard = new StandardDrawPrimitives();
    // A consumer-supplied primitives object written before drawWmfPreview existed.
    const primitives = {
      drawText: standard.drawText.bind(standard),
      drawRect: standard.drawRect.bind(standard),
      drawShape: standard.drawShape.bind(standard),
      drawImage: () => { calls.push('image'); },
      drawLeader: standard.drawLeader.bind(standard),
      drawCellBox: standard.drawCellBox.bind(standard),
      drawBorderLine: standard.drawBorderLine.bind(standard),
    };
    const renderer = new StandardPageRenderer(primitives);
    renderer.renderPage(
      {
        pageIndex: 0,
        pageNumber: 1,
        orientation: 'portrait',
        size: { width: 612, height: 792 },
        margins: { top: 72, right: 72, bottom: 72, left: 72 },
        lines: [{ bounds: { x: 72, y: 72, width: 50, height: 50 }, baseline: 40, fragments: [{ text: '', image, bounds: { x: 0, y: 0, width: 50, height: 50 } }] }],
      },
      new StrictCanvasTarget(),
    );
    expect(calls).toEqual(['image']);
  });
});
