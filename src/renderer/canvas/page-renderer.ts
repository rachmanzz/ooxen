import type { LayoutLine } from '../../layout/line-breaker.js';
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

    // 3. Render header lines if present
    if (page.headerLines) {
      this.renderLines(page.headerLines, target);
    }

    // 4. Render body lines
    this.renderLines(page.lines, target);

    // 5. Render footnote lines if present
    if (page.footnoteLines && page.footnoteLines.length > 0) {
      const topY = page.footnoteLines[0]!.bounds.y;
      // Draw standard footnote separator rule (100pt wide line)
      this.primitives.drawRect(
        target,
        { x: page.margins.left, y: topY - 6, width: 100, height: 0.75 },
        '#000000',
      );
      this.renderLines(page.footnoteLines, target);
    }

    // 6. Render footer lines if present
    if (page.footerLines) {
      this.renderLines(page.footerLines, target);
    }
  }

  private renderLines(lines: LayoutLine[], target: CanvasTarget): void {
    for (const line of lines) {
      for (const fragment of line.fragments) {
        const fragX = line.bounds.x + fragment.bounds.x;
        const fragY = line.bounds.y + fragment.bounds.y;

        if (fragment.drawing) {
          this.primitives.drawShape(target, fragment.drawing, fragX, fragY);
        } else if (fragment.image) {
          this.primitives.drawImage(target, fragment.image, fragX, fragY);
        } else {
          let style = fragment.style;
          if (fragment.revision) {
            if (fragment.revision.type === 'delete') {
              style = {
                ...fragment.style,
                strike: true,
                color: fragment.style?.color ?? '#C00000',
              };
            } else if (fragment.revision.type === 'insert') {
              style = {
                ...fragment.style,
                underline: true,
                color: fragment.style?.color ?? '#008000',
              };
            }
          }

          this.primitives.drawText(
            target,
            fragment.text,
            fragX,
            fragY,
            line.baseline,
            style,
          );
        }
      }
    }
  }
}

export const defaultPageRenderer = new StandardPageRenderer();
