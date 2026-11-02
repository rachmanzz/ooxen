import type { DocumentNode, FootnoteNode, HeaderFooterNode, ParagraphNode, SectionNode, TableNode } from '../types/ast.js';
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
  headerLines?: LayoutLine[];
  footerLines?: LayoutLine[];
  footnoteLines?: LayoutLine[];
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
    const pageMetas: { page: PageLayout; section: SectionNode; sectionPageIndex: number }[] = [];

    for (const section of document.sections) {
      const { pageSize, margins } = section.properties;
      const contentWidth = Math.max(50, pageSize.width - margins.left - margins.right);
      const contentHeight = Math.max(50, pageSize.height - margins.top - margins.bottom);

      let currentPageIndex = pages.length;
      let sectionPageIndex = 0;
      let currentLines: LayoutLine[] = [];
      let currentY = 0; // vertical position inside content box (0 to contentHeight)

      const emitPage = (): void => {
        const page: PageLayout = {
          pageIndex: currentPageIndex,
          size: { ...pageSize },
          margins: { ...margins },
          lines: currentLines,
        };
        pages.push(page);
        pageMetas.push({ page, section, sectionPageIndex });
        sectionPageIndex++;
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

    // Second pass: attach headerLines and footerLines with resolved totalPages and page numbers
    const totalPages = pages.length;
    for (const meta of pageMetas) {
      const { page, section, sectionPageIndex } = meta;
      const contentWidth = Math.max(50, page.size.width - page.margins.left - page.margins.right);

      // 1. Resolve header
      let headerNode: HeaderFooterNode | undefined;
      if (sectionPageIndex === 0 && section.properties.titlePg && section.headers?.first) {
        headerNode = section.headers.first;
      } else if (page.pageIndex % 2 === 1 && section.headers?.even) {
        headerNode = section.headers.even;
      } else {
        headerNode = section.headers?.default;
      }

      if (headerNode) {
        const headerDist = section.properties.headerDistancePt ?? 36;
        page.headerLines = this.layoutHeaderFooter(headerNode, contentWidth, headerDist, page.margins, page.pageIndex, totalPages);
      }

      // 2. Resolve footer
      let footerNode: HeaderFooterNode | undefined;
      if (sectionPageIndex === 0 && section.properties.titlePg && section.footers?.first) {
        footerNode = section.footers.first;
      } else if (page.pageIndex % 2 === 1 && section.footers?.even) {
        footerNode = section.footers.even;
      } else {
        footerNode = section.footers?.default;
      }

      if (footerNode) {
        const footerDist = section.properties.footerDistancePt ?? 36;
        const footerY = page.size.height - footerDist - 16;
        page.footerLines = this.layoutHeaderFooter(footerNode, contentWidth, footerY, page.margins, page.pageIndex, totalPages);
      }

      // 3. Resolve footnotes referenced on this page
      if (document.footnotes && document.footnotes.length > 0) {
        const referencedIds = new Set<number>();
        for (const line of page.lines) {
          for (const frag of line.fragments) {
            if (frag.footnoteRef && frag.footnoteRef.kind === 'footnote') {
              referencedIds.add(frag.footnoteRef.id);
            }
          }
        }

        if (referencedIds.size > 0) {
          const matchingFootnotes = document.footnotes.filter((fn) => referencedIds.has(fn.id));
          if (matchingFootnotes.length > 0) {
            page.footnoteLines = this.layoutFootnotes(matchingFootnotes, contentWidth, page);
          }
        }
      }
    }

    return pages;
  }

  private layoutFootnotes(footnotes: FootnoteNode[], contentWidth: number, page: PageLayout): LayoutLine[] {
    const rawLines: LayoutLine[] = [];
    let totalHeight = 0;

    for (const fn of footnotes) {
      for (const block of fn.children) {
        if (block.type === 'paragraph') {
          const pLines = this.lineBreaker.breakParagraph(block, contentWidth);
          for (const l of pLines) {
            rawLines.push(l);
            totalHeight += l.bounds.height;
          }
        }
      }
    }

    const contentBottomY = page.size.height - page.margins.bottom;
    const startY = contentBottomY - totalHeight;
    let currentY = 0;

    const positionedLines: LayoutLine[] = [];
    for (const line of rawLines) {
      positionedLines.push({
        bounds: {
          x: page.margins.left + line.bounds.x,
          y: startY + currentY + line.bounds.y,
          width: line.bounds.width,
          height: line.bounds.height,
        },
        baseline: line.baseline,
        fragments: line.fragments,
      });
      currentY += line.bounds.height;
    }

    return positionedLines;
  }

  private layoutHeaderFooter(
    node: HeaderFooterNode,
    contentWidth: number,
    baseY: number,
    margins: Margins,
    pageIndex: number,
    totalPages: number,
  ): LayoutLine[] {
    const lines: LayoutLine[] = [];
    let currentY = 0;

    for (const block of node.children) {
      if (block.type === 'paragraph') {
        const resolvedParagraph = this.resolveFields(block, pageIndex, totalPages);
        const pLines = this.lineBreaker.breakParagraph(resolvedParagraph, contentWidth);
        for (const line of pLines) {
          lines.push({
            bounds: {
              x: margins.left + line.bounds.x,
              y: baseY + currentY + line.bounds.y,
              width: line.bounds.width,
              height: line.bounds.height,
            },
            baseline: line.baseline,
            fragments: line.fragments,
          });
          currentY += line.bounds.height;
        }
      }
    }

    return lines;
  }

  private resolveFields(p: ParagraphNode, pageIndex: number, totalPages: number): ParagraphNode {
    const pageNumStr = String(pageIndex + 1);
    const totalPagesStr = String(totalPages);

    const newChildren = p.children.map((run) => {
      if (run.field === 'PAGE') {
        return { ...run, text: pageNumStr };
      }
      if (run.field === 'NUMPAGES') {
        return { ...run, text: totalPagesStr };
      }
      if (run.text.includes('{{PAGE}}') || run.text.includes('{{NUMPAGES}}')) {
        const text = run.text.replace(/\{\{PAGE\}\}/g, pageNumStr).replace(/\{\{NUMPAGES\}\}/g, totalPagesStr);
        return { ...run, text };
      }
      return run;
    });

    return { ...p, children: newChildren };
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

    // Determine target table width if specified
    let targetTableWidth: number | undefined;
    if (table.style?.widthPercent !== undefined) {
      targetTableWidth = (contentWidth * table.style.widthPercent) / 100;
    } else if (table.style?.widthPt !== undefined) {
      targetTableWidth = table.style.widthPt;
    }

    // Determine base grid column widths if w:tblGrid is provided
    let baseColWidths: number[] | undefined;
    if (table.columnWidthsPt && table.columnWidthsPt.length > 0) {
      const rawCols = [...table.columnWidthsPt];
      const rawTotal = rawCols.reduce((a, b) => a + b, 0);
      if (targetTableWidth !== undefined && rawTotal > 0) {
        const factor = targetTableWidth / rawTotal;
        baseColWidths = rawCols.map((w) => w * factor);
      } else if (rawTotal > contentWidth && rawTotal > 0) {
        const factor = contentWidth / rawTotal;
        baseColWidths = rawCols.map((w) => w * factor);
      } else {
        baseColWidths = rawCols;
      }
    }

    for (const row of table.rows) {
      const cellCount = row.children.length;
      if (cellCount === 0) continue;

      // Compute width for each cell in this row
      const cellWidths: number[] = [];
      if (baseColWidths && baseColWidths.length > 0) {
        let gridIndex = 0;
        for (let c = 0; c < cellCount; c++) {
          const cell = row.children[c]!;
          const span = cell.colSpan ?? 1;
          let cellW = 0;
          for (let s = 0; s < span && gridIndex + s < baseColWidths.length; s++) {
            cellW += baseColWidths[gridIndex + s]!;
          }
          if (cellW <= 0) {
            cellW = cell.widthPt ?? contentWidth / cellCount;
          }
          cellWidths.push(cellW);
          gridIndex += span;
        }
      } else {
        const hasExplicitWidths = row.children.some((c) => c.widthPt !== undefined);
        if (hasExplicitWidths) {
          for (let c = 0; c < cellCount; c++) {
            cellWidths.push(row.children[c]!.widthPt ?? contentWidth / cellCount);
          }
          const sumW = cellWidths.reduce((a, b) => a + b, 0);
          if (sumW > contentWidth && sumW > 0) {
            const factor = contentWidth / sumW;
            for (let i = 0; i < cellWidths.length; i++) {
              cellWidths[i]! *= factor;
            }
          }
        } else {
          const defaultW = (targetTableWidth ?? contentWidth) / cellCount;
          for (let c = 0; c < cellCount; c++) {
            cellWidths.push(defaultW);
          }
        }
      }

      // Calculate table start X coordinate based on table alignment
      const actualRowWidth = cellWidths.reduce((a, b) => a + b, 0);
      let startX = margins.left;
      const alignment = table.style?.alignment ?? 'left';
      if (alignment === 'center') {
        const remaining = Math.max(0, contentWidth - actualRowWidth);
        startX += remaining / 2;
      } else if (alignment === 'right') {
        const remaining = Math.max(0, contentWidth - actualRowWidth);
        startX += remaining;
      }

      // Calculate X positions for each cell
      const cellXPositions: number[] = [];
      let currentX = startX;
      for (let c = 0; c < cellCount; c++) {
        cellXPositions.push(currentX);
        currentX += cellWidths[c]!;
      }

      let maxCellHeight = 20;
      const cellLinesMap: LayoutLine[][] = [];
      const cellContentHeights: number[] = [];
      const cellPaddings: { top: number; bottom: number; left: number; right: number }[] = [];

      for (let c = 0; c < cellCount; c++) {
        const cell = row.children[c]!;
        const cellW = cellWidths[c]!;
        const padTop = cell.style?.paddingTopPt ?? table.style?.cellMarginTopPt ?? 2;
        const padBottom = cell.style?.paddingBottomPt ?? table.style?.cellMarginBottomPt ?? 2;
        const padLeft = cell.style?.paddingLeftPt ?? table.style?.cellMarginLeftPt ?? 4;
        const padRight = cell.style?.paddingRightPt ?? table.style?.cellMarginRightPt ?? 4;
        cellPaddings.push({ top: padTop, bottom: padBottom, left: padLeft, right: padRight });

        const innerWidth = Math.max(10, cellW - padLeft - padRight);
        const cellLines: LayoutLine[] = [];
        let cellY = 0;

        for (const child of cell.children) {
          if (child.type === 'paragraph') {
            const pLines = this.lineBreaker.breakParagraph(child, innerWidth);
            for (const pl of pLines) {
              cellLines.push({
                bounds: {
                  x: pl.bounds.x,
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
                x: 0,
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
                x: 0,
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
        cellContentHeights.push(cellY);
        const totalCellH = padTop + cellY + padBottom;
        if (totalCellH > maxCellHeight) {
          maxCellHeight = totalCellH;
        }
      }

      const explicitRowHeight = row.heightPt ?? 0;
      const rowHeight = Math.max(explicitRowHeight, maxCellHeight, 20);

      // Check page break for row
      if (y + rowHeight > contentHeight && y > 0) {
        onPageOverflow();
        y = 0;
      }

      // Place cell lines into page with vertical alignment applied
      for (let c = 0; c < cellCount; c++) {
        const cell = row.children[c]!;
        const cellX = cellXPositions[c]!;
        const lines = cellLinesMap[c] ?? [];
        const pad = cellPaddings[c]!;
        const contentH = cellContentHeights[c]!;
        const vAlign = cell.style?.verticalAlign ?? 'top';

        const extraSpace = rowHeight - pad.top - pad.bottom - contentH;
        let vOffset = pad.top;
        if (extraSpace > 0) {
          if (vAlign === 'center') {
            vOffset += extraSpace / 2;
          } else if (vAlign === 'bottom') {
            vOffset += extraSpace;
          }
        }

        for (const l of lines) {
          pushLine({
            bounds: {
              x: cellX + pad.left + l.bounds.x,
              y: margins.top + y + vOffset + l.bounds.y,
              width: l.bounds.width,
              height: l.bounds.height,
            },
            fragments: l.fragments,
            baseline: l.baseline,
          });
        }
      }

      y += rowHeight;
    }

    setY(y);
  }
}

export const defaultPageEngine = new StandardPageEngine();
