import type { PageLayout } from '../../layout/page-engine.js';
import type { CanvasTarget } from './canvas-target.js';
import { defaultDrawPrimitives, type DrawPrimitives } from './draw-primitives.js';

export interface PageRenderOptions {
  backgroundColor?: string;
  drawMarginGuide?: boolean;
}

/**
 * Host-Agnostic Page Renderer.
 * Renders a single discrete PageLayout onto a provided CanvasTarget.
 */
export interface PageRenderer {
  renderPage(page: PageLayout, target: CanvasTarget, options?: PageRenderOptions): void;
}

export class StandardPageRenderer implements PageRenderer {
  private primitives: DrawPrimitives;

  constructor(primitives: DrawPrimitives = defaultDrawPrimitives) {
    this.primitives = primitives;
  }

  renderPage(page: PageLayout, target: CanvasTarget, options?: PageRenderOptions): void {
    const bgColor = options?.backgroundColor ?? '#FFFFFF';

    // 1. Draw page paper background
    this.primitives.drawRect(
      target,
      { x: 0, y: 0, width: page.size.width, height: page.size.height },
      bgColor,
    );

    // 2. Optionally draw margin guide lines
    if (options?.drawMarginGuide) {
      const { margins, size } = page;
      this.primitives.drawRect(
        target,
        {
          x: margins.left,
          y: margins.top,
          width: size.width - margins.left - margins.right,
          height: size.height - margins.top - margins.bottom,
        },
        undefined,
        '#E0E0E0',
        0.5,
      );
    }

    // 3. Render each line and its fragments
    for (const line of page.lines) {
      for (const fragment of line.fragments) {
        const fragX = line.bounds.x + fragment.bounds.x;
        const fragY = line.bounds.y + fragment.bounds.y;

        this.primitives.drawText(
          target,
          fragment.text,
          fragX,
          fragY,
          line.baseline,
          fragment.style,
        );
      }
    }
  }
}

export const defaultPageRenderer = new StandardPageRenderer();
