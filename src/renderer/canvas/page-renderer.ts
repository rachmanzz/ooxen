import type { LayoutLine } from '../../layout/line-breaker.js';
import type { PageLayout } from '../../layout/page-engine.js';
import type { Size } from '../../types/common.js';
import type { CanvasTarget } from './canvas-target.js';
import { defaultDrawPrimitives, type DrawPrimitives } from './draw-primitives.js';

export interface PageMetaEvent {
  pageIndex: number;
  pageNumber: number;
  totalPageCount?: number;
  formattedPageNumber?: string;
  orientation: string;
  size: Size;
}

export interface PageRenderOptions {
  backgroundColor?: string;
  drawMarginGuide?: boolean;
  renderBackground?: boolean; // default: true
  renderHeader?: boolean; // default: true
  renderFooter?: boolean; // default: true
  bodyOnly?: boolean; // default: false (when true, only renders body content to canvas; chrome can be received via callbacks)
  onHeader?: (headerLines: LayoutLine[], page: PageLayout) => void;
  onFooter?: (footerLines: LayoutLine[], page: PageLayout) => void;
  onPageMeta?: (meta: PageMetaEvent) => void;
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
    // 0. Notify page metadata callback if subscriber is attached (e.g. book-canvas)
    if (options?.onPageMeta) {
      options.onPageMeta({
        pageIndex: page.pageIndex,
        pageNumber: page.pageNumber,
        totalPageCount: page.totalPageCount,
        formattedPageNumber: page.formattedPageNumber,
        orientation: page.orientation,
        size: page.size,
      });
    }

    const isBodyOnly = options?.bodyOnly === true;

    // 1. Draw page paper background
    if (!isBodyOnly && options?.renderBackground !== false) {
      const bgColor = options?.backgroundColor ?? '#FFFFFF';
      this.primitives.drawRect(
        target,
        { x: 0, y: 0, width: page.size.width, height: page.size.height },
        bgColor,
      );
    }

    // 2. Optionally draw margin guide lines
    if (!isBodyOnly && options?.drawMarginGuide) {
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

    // 3. Render table cell backgrounds and borders if present
    if (page.cellBoxes && page.cellBoxes.length > 0) {
      for (const cell of page.cellBoxes) {
        this.primitives.drawCellBox(target, cell);
      }
    }

    // 4. Render header lines if present
    if (page.headerLines) {
      if (options?.onHeader) {
        options.onHeader(page.headerLines, page);
      }
      if (!isBodyOnly && options?.renderHeader !== false) {
        this.renderLines(page.headerLines, target);
      }
    }

    // 4. Render body lines
    this.renderLines(page.lines, target);

    // 5. Render footnote lines if present
    if (page.footnoteLines && page.footnoteLines.length > 0) {
      const topY = page.footnoteLines[0]!.bounds.y;
      // Draw standard footnote separator rule (100pt wide line)
      if (!isBodyOnly) {
        this.primitives.drawRect(
          target,
          { x: page.margins.left, y: topY - 6, width: 100, height: 0.75 },
          '#000000',
        );
      }
      this.renderLines(page.footnoteLines, target);
    }

    // 6. Render footer lines if present
    if (page.footerLines) {
      if (options?.onFooter) {
        options.onFooter(page.footerLines, page);
      }
      if (!isBodyOnly && options?.renderFooter !== false) {
        this.renderLines(page.footerLines, target);
      }
    }
  }

  private renderLines(lines: LayoutLine[], target: CanvasTarget): void {
    for (const line of lines) {
      // Behind-document floats paint before text so content stays on top.
      const ordered = [...line.fragments].sort((a, b) => {
        const aBehind = a.image?.anchor?.behindDoc === true ? 0 : 1;
        const bBehind = b.image?.anchor?.behindDoc === true ? 0 : 1;
        return aBehind - bBehind;
      });
      for (const fragment of ordered) {
        const fragX = line.bounds.x + fragment.bounds.x;
        const fragY = line.bounds.y + fragment.bounds.y;

        if (fragment.drawing) {
          this.primitives.drawShape(target, fragment.drawing, fragX, fragY);
        } else if (fragment.image) {
          this.primitives.drawImage(target, fragment.image, fragX, fragY);
        } else if (fragment.isTab) {
          if (fragment.barTab) {
            // Bar tab stop: vertical rule spanning the line height.
            this.primitives.drawRect(
              target,
              { x: fragX, y: line.bounds.y, width: 0.75, height: line.bounds.height },
              fragment.style?.color ?? '#000000',
            );
          } else if (fragment.tabLeader && fragment.tabLeader !== 'none') {
            this.primitives.drawLeader(
              target,
              fragment.tabLeader,
              fragX,
              fragY,
              fragment.bounds.width,
              line.baseline,
              fragment.style,
            );
          }
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
