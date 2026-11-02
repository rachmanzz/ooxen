import type { DocumentNode, ParagraphNode, TableNode } from '../types/ast.js';
import type { Margins, Size } from '../types/common.js';
import { defaultLineBreaker, type LayoutLine, type LineBreaker } from './line-breaker.js';

/**
 * Geometric layout and pagination model according to ISO/IEC 29500-1.
 */

export interface PageLayout {
  pageIndex: number;
  size: Size; // points
  margins: Margins; // points
  lines: LayoutLine[];
}

export interface PageEngine {
  layoutDocument(document: DocumentNode): PageLayout[];
}

export class StandardPageEngine implements PageEngine {
  private lineBreaker: LineBreaker;

  constructor(lineBreaker: LineBreaker = defaultLineBreaker) {
    this.lineBreaker = lineBreaker;
  }

  layoutDocument(document: DocumentNode): PageLayout[] {
    const pages: PageLayout[] = [];

    for (const section of document.sections) {
      const { pageSize, margins } = section.properties;
      const contentWidth = Math.max(50, pageSize.width - margins.left - margins.right);
      const contentHeight = Math.max(50, pageSize.height - margins.top - margins.bottom);

      let currentPageIndex = pages.length;
      let currentLines: LayoutLine[] = [];
      let currentY = 0; // vertical position inside content box (0 to contentHeight)

      const emitPage = (): void => {
        pages.push({
          pageIndex: currentPageIndex,
          size: { ...pageSize },
          margins: { ...margins },
          lines: currentLines,
        });
        currentPageIndex++;
        currentLines = [];
        currentY = 0;
      };

      for (const block of section.children) {
        if (block.type === 'paragraph') {
          this.layoutParagraph(
            block,
            contentWidth,
            contentHeight,
            margins,
            (line) => {
              currentLines.push(line);
            },
            () => {
              emitPage();
            },
            () => currentY,
            (newY) => {
              currentY = newY;
            },
          );
        } else if (block.type === 'table') {
          this.layoutTable(
            block,
            contentWidth,
            contentHeight,
            margins,
            (line) => {
              currentLines.push(line);
            },
            () => {
              emitPage();
            },
            () => currentY,
            (newY) => {
              currentY = newY;
            },
          );
        } else if (block.type === 'drawing') {
          if (currentY + block.heightPt > contentHeight && currentLines.length > 0) {
            emitPage();
          }
          currentLines.push({
            bounds: {
              x: margins.left,
              y: margins.top + currentY,
              width: block.widthPt,
              height: block.heightPt,
            },
            fragments: [
              {
                text: '',
                drawing: block,
                bounds: { x: 0, y: 0, width: block.widthPt, height: block.heightPt },
              },
            ],
            baseline: block.heightPt,
          });
          currentY += block.heightPt;
        } else if (block.type === 'image') {
          if (currentY + block.heightPt > contentHeight && currentLines.length > 0) {
            emitPage();
          }
          currentLines.push({
            bounds: {
              x: margins.left,
              y: margins.top + currentY,
              width: block.widthPt,
              height: block.heightPt,
            },
            fragments: [
              {
                text: '',
                image: block,
                bounds: { x: 0, y: 0, width: block.widthPt, height: block.heightPt },
              },
            ],
            baseline: block.heightPt,
          });
          currentY += block.heightPt;
        }
      }

      if (currentLines.length > 0 || pages.length === 0) {
        emitPage();
      }
    }

    return pages;
  }

  private layoutParagraph(
    p: ParagraphNode,
    contentWidth: number,
    contentHeight: number,
    margins: Margins,
    pushLine: (line: LayoutLine) => void,
    onPageOverflow: () => void,
    getY: () => number,
    setY: (y: number) => void,
  ): void {
    const spaceBefore = p.style?.spaceBeforePt ?? 0;
    const spaceAfter = p.style?.spaceAfterPt ?? 0;

    let y = getY();
    if (y > 0 && spaceBefore > 0) {
      if (y + spaceBefore > contentHeight) {
        onPageOverflow();
        y = 0;
      } else {
        y += spaceBefore;
      }
    }

    const lines = this.lineBreaker.breakParagraph(p, contentWidth);

    for (const line of lines) {
      if (y + line.bounds.height > contentHeight && y > 0) {
        onPageOverflow();
        y = 0;
      }

      // Convert line coordinates to page-space (relative to margin origin)
      const pageLine: LayoutLine = {
        bounds: {
          x: margins.left + line.bounds.x,
          y: margins.top + y,
          width: line.bounds.width,
          height: line.bounds.height,
        },
        fragments: line.fragments,
        baseline: line.baseline,
      };

      pushLine(pageLine);
      y += line.bounds.height;
    }

    if (spaceAfter > 0) {
      y += spaceAfter;
    }

    setY(y);
  }

  private layoutTable(
    table: TableNode,
    contentWidth: number,
    contentHeight: number,
    margins: Margins,
    pushLine: (line: LayoutLine) => void,
    onPageOverflow: () => void,
    getY: () => number,
    setY: (y: number) => void,
  ): void {
    let y = getY();
    const rowCount = table.rows.length;
    if (rowCount === 0) return;

    for (const row of table.rows) {
      const cellCount = row.children.length;
      if (cellCount === 0) continue;

      const colWidth = contentWidth / cellCount;
      let maxCellHeight = 20;

      // Layout each cell
      const cellLinesMap: LayoutLine[][] = [];

      for (let c = 0; c < cellCount; c++) {
        const cell = row.children[c]!;
        const cellLines: LayoutLine[] = [];
        let cellY = 0;

        for (const child of cell.children) {
          if (child.type === 'paragraph') {
            const pLines = this.lineBreaker.breakParagraph(child, colWidth - 8); // 4pt padding
            for (const pl of pLines) {
              cellLines.push({
                bounds: {
                  x: pl.bounds.x + 4,
                  y: cellY + pl.bounds.y,
                  width: pl.bounds.width,
                  height: pl.bounds.height,
                },
                fragments: pl.fragments,
                baseline: pl.baseline,
              });
              cellY += pl.bounds.height;
            }
          } else if (child.type === 'drawing') {
            cellLines.push({
              bounds: {
                x: 4,
                y: cellY,
                width: child.widthPt,
                height: child.heightPt,
              },
              fragments: [
                {
                  text: '',
                  drawing: child,
                  bounds: { x: 0, y: 0, width: child.widthPt, height: child.heightPt },
                },
              ],
              baseline: child.heightPt,
            });
            cellY += child.heightPt;
          } else if (child.type === 'image') {
            cellLines.push({
              bounds: {
                x: 4,
                y: cellY,
                width: child.widthPt,
                height: child.heightPt,
              },
              fragments: [
                {
                  text: '',
                  image: child,
                  bounds: { x: 0, y: 0, width: child.widthPt, height: child.heightPt },
                },
              ],
              baseline: child.heightPt,
            });
            cellY += child.heightPt;
          }
        }

        cellLinesMap.push(cellLines);
        if (cellY > maxCellHeight) {
          maxCellHeight = cellY;
        }
      }

      // Check page break for row
      if (y + maxCellHeight > contentHeight && y > 0) {
        onPageOverflow();
        y = 0;
      }

      // Place cell lines into page
      for (let c = 0; c < cellCount; c++) {
        const cellX = margins.left + c * colWidth;
        const lines = cellLinesMap[c] ?? [];

        for (const l of lines) {
          pushLine({
            bounds: {
              x: cellX + l.bounds.x,
              y: margins.top + y + l.bounds.y,
              width: l.bounds.width,
              height: l.bounds.height,
            },
            fragments: l.fragments,
            baseline: l.baseline,
          });
        }
      }

      y += maxCellHeight;
    }

    setY(y);
  }
}

export const defaultPageEngine = new StandardPageEngine();
