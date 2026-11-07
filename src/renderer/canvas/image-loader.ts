import type { BlockNode, DocumentNode, ImageNode } from '../../types/ast.js';

/**
 * Async image preparation for the canvas renderer.
 *
 * A raw 2D context cannot draw a URL string — passing `image.src` to
 * `ctx.drawImage` throws and aborts the whole page render. Bitmaps must
 * therefore be decoded *before* the first frame and handed to the draw
 * primitives through the cache below. This module is runtime-agnostic:
 * decoding is injected by the host (browsers supply fetch +
 * createImageBitmap; other runtimes supply their own loader or skip
 * preloading and get placeholders).
 */

export type ImageBitmapLoader = (src: string) => Promise<CanvasImageSource | undefined>;

const bitmapCache = new WeakMap<ImageNode, CanvasImageSource>();

export function getCachedBitmap(image: ImageNode): CanvasImageSource | undefined {
  return bitmapCache.get(image);
}

export function cacheBitmap(image: ImageNode, bitmap: CanvasImageSource): void {
  bitmapCache.set(image, bitmap);
}

function collectBlockImages(block: BlockNode, out: ImageNode[]): void {
  if (block.type === 'image') {
    out.push(block);
  } else if (block.type === 'paragraph') {
    for (const run of block.children) {
      if (run.image) out.push(run.image);
    }
  } else if (block.type === 'table') {
    for (const row of block.rows) {
      for (const cell of row.children) {
        for (const child of cell.children) collectBlockImages(child, out);
      }
    }
  }
}

export function collectImageNodes(document: DocumentNode): ImageNode[] {
  const out: ImageNode[] = [];
  for (const section of document.sections) {
    for (const block of section.children) collectBlockImages(block, out);
    if (section.headers) {
      for (const kind of ['default', 'first', 'even'] as const) {
        const node = section.headers[kind];
        if (node) for (const block of node.children) collectBlockImages(block, out);
      }
    }
    if (section.footers) {
      for (const kind of ['default', 'first', 'even'] as const) {
        const node = section.footers[kind];
        if (node) for (const block of node.children) collectBlockImages(block, out);
      }
    }
  }
  return out;
}

/**
 * Default loader for browsers and workers. Returns undefined where
 * fetch or createImageBitmap is unavailable (Node without a canvas
 * stack, minimal workers) — callers then keep placeholders.
 */
export function defaultImageLoader(): ImageBitmapLoader | undefined {
  const g = globalThis as {
    fetch?: typeof fetch;
    createImageBitmap?: typeof createImageBitmap;
  };
  if (typeof g.fetch !== 'function' || typeof g.createImageBitmap !== 'function') {
    return undefined;
  }
  return async (src: string): Promise<CanvasImageSource | undefined> => {
    try {
      const response = await g.fetch!(src);
      if (!response.ok) return undefined;
      return await g.createImageBitmap!(await response.blob());
    } catch {
      return undefined;
    }
  };
}

export interface ImagePreloadResult {
  loaded: number;
  failed: number;
  /** True when no loader was available, so every image keeps its placeholder. */
  skipped: boolean;
}

/**
 * Decodes every distinct image URL in the document and caches the
 * bitmaps for the canvas renderer. Never rejects: per-image failures
 * are counted, and a missing loader reports `skipped`.
 *
 * Await this before the first frame; drawing without it renders
 * placeholders instead of crashing.
 */
export async function preloadDocumentImages(
  document: DocumentNode,
  loader?: ImageBitmapLoader,
): Promise<ImagePreloadResult> {
  try {
    const pending = collectImageNodes(document).filter(
      (node) => typeof node.src === 'string' && !bitmapCache.has(node),
    );
    const effective = loader ?? defaultImageLoader();
    if (!effective) {
      return { loaded: 0, failed: 0, skipped: pending.length > 0 };
    }

    const bySrc = new Map<string, ImageNode[]>();
    for (const node of pending) {
      const list = bySrc.get(node.src!);
      if (list) list.push(node);
      else bySrc.set(node.src!, [node]);
    }

    let loaded = 0;
    let failed = 0;
    await Promise.all(
      [...bySrc.entries()].map(async ([src, nodes]) => {
        const bitmap = await effective(src);
        if (bitmap) {
          for (const node of nodes) bitmapCache.set(node, bitmap);
          loaded += nodes.length;
        } else {
          failed += nodes.length;
        }
      }),
    );
    return { loaded, failed, skipped: false };
  } catch {
    return { loaded: 0, failed: 0, skipped: true };
  }
}
