import type {
  BlockNode,
  DocumentNode,
  FootnoteNode,
  HeaderFooterNode,
  PageOrientation,
  ParagraphNode,
  SectionNode,
  TableNode,
} from '../types/ast.js';
import type { Margins, Rect, Size } from '../types/common.js';
import { defaultLineBreaker, type LayoutLine, type LineBreaker } from './line-breaker.js';

/**
 * Geometric layout and pagination model according to ISO/IEC 29500-1.
 */

export interface BorderStyle {
  style?: string; // 'single' | 'dashed' | 'dotted' | 'double' | 'wave' | 'none';
  widthPt?: number;
  color?: string;
}

/**
 * Reference geometry for resolving floating-image anchors (F-ANCHOR).
 * Page size is constant per section; the index and column width are read
 * live because pages and columns turn over mid-paragraph.
 */
export interface FloatingAnchorContext {
  pageWidthPt: number;
  pageHeightPt: number;
  getPageIndex: () => number;
  getColumnWidthPt: () => number;
}

export interface CellBox {
  bounds: Rect; // page-space coordinates
  backgroundColor?: string;
  borderTop?: BorderStyle;
  borderRight?: BorderStyle;
  borderBottom?: BorderStyle;
  borderLeft?: BorderStyle;
}

export function parseBorderStyle(borderStr?: string): BorderStyle | undefined {
  if (!borderStr || borderStr === 'none' || borderStr === 'nil') return undefined;

  const parts = borderStr.trim().split(/\s+/);
  let style = 'single';
  let widthPt = 1;
  let color = '#000000';

  for (const part of parts) {
    if (part.endsWith('pt')) {
      const num = parseFloat(part);
      if (!Number.isNaN(num)) widthPt = num;
    } else if (part.endsWith('px')) {
      const num = parseFloat(part);
      if (!Number.isNaN(num)) widthPt = num * 0.75;
    } else if (part.startsWith('#') || part.startsWith('rgb')) {
      color = part;
    } else if (['single', 'solid', 'dashed', 'dotted', 'double', 'wave'].includes(part.toLowerCase())) {
      style = part.toLowerCase() === 'solid' ? 'single' : part.toLowerCase();
    }
  }

  return { style, widthPt, color };
}

export interface PageLayout {
  pageIndex: number; // 0-based physical page index
  pageNumber: number; // 1-based logical page number (respecting restarts)
  totalPageCount?: number;
  formattedPageNumber?: string;
  orientation: PageOrientation;
  size: Size; // points
  margins: Margins; // points
  lines: LayoutLine[];
  cellBoxes?: CellBox[];
  headerLines?: LayoutLine[];
  footerLines?: LayoutLine[];
  footnoteLines?: LayoutLine[];
}

export function formatPageNumber(num: number, format?: string): string {
  if (num <= 0) return String(num);
  const fmt = format?.toLowerCase();
  if (fmt === 'upperroman' || fmt === 'lowerroman') {
    const romanNumerals: [number, string][] = [
      [1000, 'M'],
      [900, 'CM'],
      [500, 'D'],
      [400, 'CD'],
      [100, 'C'],
      [90, 'XC'],
      [50, 'L'],
      [40, 'XL'],
      [10, 'X'],
      [9, 'IX'],
      [5, 'V'],
      [4, 'IV'],
      [1, 'I'],
    ];
    let result = '';
    let val = num;
    for (const [v, r] of romanNumerals) {
      while (val >= v) {
        result += r;
        val -= v;
      }
    }
    return fmt === 'lowerroman' ? result.toLowerCase() : result;
  }
  if (fmt === 'upperletter' || fmt === 'lowerletter') {
    let result = '';
    let val = num;
    while (val > 0) {
      val--;
      result = String.fromCharCode(65 + (val % 26)) + result;
      val = Math.floor(val / 26);
    }
    return fmt === 'lowerletter' ? result.toLowerCase() : result;
  }
  return String(num);
}

export interface PageEngine {
  layoutDocument(document: DocumentNode): PageLayout[];
}

/**
 * Vertical gap kept between body content and the footnote block.
 * The canvas renderer draws the separator rule 6pt above the first
 * footnote line, so 8pt keeps body clear of both rule and text.
 */
const FOOTNOTE_SEPARATOR_GAP_PT = 8;

export class StandardPageEngine implements PageEngine {
  private lineBreaker: LineBreaker;
  private footnoteHeightCache = new Map<string, number>();

  constructor(lineBreaker: LineBreaker = defaultLineBreaker) {
    this.lineBreaker = lineBreaker;
  }

  layoutDocument(document: DocumentNode): PageLayout[] {
    // Footnote heights depend on document content; never reuse across documents.
    this.footnoteHeightCache.clear();
    const pages: PageLayout[] = [];
    const pageMetas: { page: PageLayout; section: SectionNode; sectionPageIndex: number }[] = [];
    let currentLogicalPageNumber = 1;

    for (let sIdx = 0; sIdx < document.sections.length; sIdx++) {
      const section = document.sections[sIdx]!;
      const { pageSize, margins } = section.properties;
      const orientation: PageOrientation =
        section.properties.orientation ?? (pageSize.width > pageSize.height ? 'landscape' : 'portrait');

      // Restart or set logical page numbering if configured (w:pgNumType)
      if (section.properties.pageNumbering?.start !== undefined) {
        currentLogicalPageNumber = section.properties.pageNumbering.start;
      }
      const currentNumberingFormat = section.properties.pageNumbering?.format;

      const contentWidth = Math.max(50, pageSize.width - margins.left - margins.right);
      const contentHeight = Math.max(50, pageSize.height - margins.top - margins.bottom);

      // Section Break Transitions (w:type)
      const breakType = section.properties.type ?? 'nextPage';
      let resumedPage: PageLayout | undefined;
      let resumedMeta: { page: PageLayout; section: SectionNode; sectionPageIndex: number } | undefined;
      let resumedUsedHeight = 0;

      if (sIdx > 0) {
        if (breakType === 'evenPage') {
          // Must start on even physical page (pageIndex % 2 === 1)
          if (pages.length % 2 === 0) {
            const blankPage: PageLayout = {
              pageIndex: pages.length,
              pageNumber: currentLogicalPageNumber++,
              orientation,
              size: { ...pageSize },
              margins: { ...margins },
              lines: [],
            };
            pages.push(blankPage);
            pageMetas.push({ page: blankPage, section, sectionPageIndex: -1 });
          }
        } else if (breakType === 'oddPage') {
          // Must start on odd physical page (pageIndex % 2 === 0)
          if (pages.length % 2 === 1) {
            const blankPage: PageLayout = {
              pageIndex: pages.length,
              pageNumber: currentLogicalPageNumber++,
              orientation,
              size: { ...pageSize },
              margins: { ...margins },
              lines: [],
            };
            pages.push(blankPage);
            pageMetas.push({ page: blankPage, section, sectionPageIndex: -1 });
          }
        } else if (breakType === 'continuous' && pages.length > 0) {
          const prevPage = pages[pages.length - 1];
          const prevMeta = pageMetas[pageMetas.length - 1];
          if (
            prevPage &&
            prevMeta &&
            prevPage.size.width === pageSize.width &&
            prevPage.size.height === pageSize.height &&
            prevPage.margins.top === margins.top &&
            prevPage.margins.bottom === margins.bottom
          ) {
            let maxBottom = margins.top;
            for (const l of prevPage.lines) {
              maxBottom = Math.max(maxBottom, l.bounds.y + l.bounds.height);
            }
            const usedHeight = maxBottom - margins.top;
            if (usedHeight < contentHeight - 20) {
              pages.pop();
              pageMetas.pop();
              resumedPage = prevPage;
              resumedMeta = prevMeta;
              resumedUsedHeight = usedHeight;
            }
          }
        }
      }

      // Multi-column setup (w:cols)
      const columnsProp = section.properties.columns;
      const colCount = Math.max(1, columnsProp?.count ?? 1);
      const defaultSpacePt = columnsProp?.spacePt ?? 36;

      const columnWidths: number[] = [];
      const columnStartX: number[] = [];

      if (colCount > 1) {
        if (columnsProp?.equalWidth !== false || !columnsProp?.columns || columnsProp.columns.length === 0) {
          const totalSpace = (colCount - 1) * defaultSpacePt;
          const colWidth = Math.max(20, (contentWidth - totalSpace) / colCount);
          for (let c = 0; c < colCount; c++) {
            columnWidths.push(colWidth);
            columnStartX.push(margins.left + c * (colWidth + defaultSpacePt));
          }
        } else {
          let curX = margins.left;
          for (let c = 0; c < colCount; c++) {
            const colDef = columnsProp.columns[c];
            const w = colDef?.widthPt ?? contentWidth / colCount;
            const s = colDef?.spacePt ?? defaultSpacePt;
            columnWidths.push(w);
            columnStartX.push(curX);
            curX += w + s;
          }
        }
      } else {
        columnWidths.push(contentWidth);
        columnStartX.push(margins.left);
      }

      let currentPageIndex = pages.length;
      let sectionPageIndex = 0;
      let currentLines: LayoutLine[] = [];
      let currentCellBoxes: CellBox[] = [];
      let currentColumnIndex = 0;
      let currentY = 0; // vertical position inside content box (0 to contentHeight)

      // Footnote reservation (F-FNOTE-PAG): footnote bodies are measured up
      // front so the body never flows into the footnote zone at the bottom of
      // the page. Reservation is per emitted page and reset in emitPage.
      const footnoteById = new Map<number, FootnoteNode>();
      for (const fn of document.footnotes ?? []) {
        if (fn.kind === 'footnote') footnoteById.set(fn.id, fn);
      }
      let reservedFootnotePt = 0;
      const reservedFootnoteIds = new Set<number>();

      const measureFootnote = (id: number, width: number): number => {
        const key = `${width}:${id}`;
        const cached = this.footnoteHeightCache.get(key);
        if (cached !== undefined) return cached;
        const fn = footnoteById.get(id);
        const raw = fn ? this.buildFootnoteRawLines([fn], width) : [];
        const height = raw.reduce((acc, l) => acc + l.bounds.height, 0);
        this.footnoteHeightCache.set(key, height);
        return height;
      };

      const collectFootnoteRefIds = (node: BlockNode, out: Set<number>): void => {
        if (node.type === 'paragraph') {
          for (const run of node.children) {
            const ref = run.footnoteRef;
            if (ref && ref.kind === 'footnote' && footnoteById.has(ref.id)) out.add(ref.id);
          }
        } else if (node.type === 'table') {
          for (const row of node.rows) {
            for (const cell of row.children) {
              for (const child of cell.children) collectFootnoteRefIds(child, out);
            }
          }
        }
      };

      if (resumedPage) {
        currentPageIndex = resumedPage.pageIndex;
        sectionPageIndex = resumedMeta ? resumedMeta.sectionPageIndex : 0;
        currentLines = [...resumedPage.lines];
        currentCellBoxes = [...(resumedPage.cellBoxes ?? [])];
        currentY = resumedUsedHeight + 12;
        currentLogicalPageNumber = resumedPage.pageNumber;
        // Carry the resumed page's footnote reservation so continued body
        // content still clears footnotes referenced before the break.
        for (const line of currentLines) {
          for (const frag of line.fragments) {
            const ref = frag.footnoteRef;
            if (ref && ref.kind === 'footnote' && footnoteById.has(ref.id) && !reservedFootnoteIds.has(ref.id)) {
              if (reservedFootnoteIds.size === 0) reservedFootnotePt += FOOTNOTE_SEPARATOR_GAP_PT;
              reservedFootnoteIds.add(ref.id);
              reservedFootnotePt += measureFootnote(ref.id, contentWidth);
            }
          }
        }
      }

      const emitPage = (): void => {
        const fmtPageNum = formatPageNumber(currentLogicalPageNumber, currentNumberingFormat);
        const page: PageLayout = {
          pageIndex: currentPageIndex,
          pageNumber: currentLogicalPageNumber,
          formattedPageNumber: fmtPageNum,
          orientation,
          size: { ...pageSize },
          margins: { ...margins },
          lines: currentLines,
          cellBoxes: currentCellBoxes.length > 0 ? currentCellBoxes : undefined,
        };
        pages.push(page);
        pageMetas.push({ page, section, sectionPageIndex });
        currentLogicalPageNumber++;
        sectionPageIndex++;
        currentPageIndex++;
        currentLines = [];
        currentCellBoxes = [];
        currentColumnIndex = 0;
        currentY = 0;
        // A new page starts with no footnote reservation; the next block
        // re-derives it via ensurePendingSpace.
        reservedFootnoteIds.clear();
        reservedFootnotePt = 0;
      };

      const onColumnOrPageOverflow = (): void => {
        if (currentColumnIndex < colCount - 1) {
          currentColumnIndex++;
          currentY = 0;
        } else {
          emitPage();
        }
      };

      const getActiveColWidth = (): number => columnWidths[currentColumnIndex] ?? contentWidth;
      const getActiveColStartX = (): number => columnStartX[currentColumnIndex] ?? margins.left;

      const dynamicMargins: Margins = {
        get top() {
          return margins.top;
        },
        get bottom() {
          return margins.bottom;
        },
        get right() {
          return margins.right;
        },
        get left() {
          return getActiveColStartX();
        },
      };

      for (let bIndex = 0; bIndex < section.children.length; bIndex++) {
        const block = section.children[bIndex]!;
        // Per-block footnote bookkeeping (F-FNOTE-PAG): ids this block
        // references that are neither reserved yet nor already placed on a
        // closed page. Refs placed before a mid-block break stay with the
        // closing page; the remainder is re-reserved after the break.
        const blockFootnoteIds = new Set<number>();
        collectFootnoteRefIds(block, blockFootnoteIds);
        for (const id of reservedFootnoteIds) blockFootnoteIds.delete(id);
        const placedFootnoteIds = new Set<number>();
        const scanPlacedFootnoteRefs = (): void => {
          for (const line of currentLines) {
            for (const frag of line.fragments) {
              const ref = frag.footnoteRef;
              if (ref && blockFootnoteIds.has(ref.id)) placedFootnoteIds.add(ref.id);
            }
          }
        };
        const ensurePendingFootnoteSpace = (): void => {
          const needed = [...blockFootnoteIds].filter(
            (id) => !reservedFootnoteIds.has(id) && !placedFootnoteIds.has(id),
          );
          if (needed.length === 0) return;
          let added = reservedFootnoteIds.size === 0 ? FOOTNOTE_SEPARATOR_GAP_PT : 0;
          for (const id of needed) added += measureFootnote(id, getActiveColWidth());
          if (currentY > 0 && currentY + reservedFootnotePt + added > contentHeight) {
            scanPlacedFootnoteRefs();
            onColumnOrPageOverflow();
            const stillNeeded = [...blockFootnoteIds].filter(
              (id) => !reservedFootnoteIds.has(id) && !placedFootnoteIds.has(id),
            );
            if (stillNeeded.length === 0) return;
            added = reservedFootnoteIds.size === 0 ? FOOTNOTE_SEPARATOR_GAP_PT : 0;
            for (const id of stillNeeded) {
              added += measureFootnote(id, getActiveColWidth());
              reservedFootnoteIds.add(id);
            }
            reservedFootnotePt += added;
            return;
          }
          for (const id of needed) reservedFootnoteIds.add(id);
          reservedFootnotePt += added;
        };
        const blockOverflow = (): void => {
          scanPlacedFootnoteRefs();
          onColumnOrPageOverflow();
          ensurePendingFootnoteSpace();
        };
        ensurePendingFootnoteSpace();
        // Body blocks are laid in the height left after footnote reservation.
        // The 12pt floor keeps pathological (taller-than-page) footnotes from
        // stalling pagination; their excess flows to continuation pages below.
        const effectiveContentHeight = Math.max(12, contentHeight - reservedFootnotePt);
        if (block.type === 'paragraph') {
          if (block.style?.pageBreakBefore && (currentY > 0 || currentLines.length > 0 || currentColumnIndex > 0)) {
            emitPage();
            ensurePendingFootnoteSpace();
          }

          if (block.style?.keepNext && bIndex + 1 < section.children.length && (currentY > 0 || currentLines.length > 0)) {
            const curLines = this.lineBreaker.breakParagraph(block, getActiveColWidth());
            const curHeight = curLines.reduce((acc, l) => acc + l.bounds.height, 0) + (block.style?.spaceBeforePt ?? 0);
            const nextEstimatedFirstLineHeight = 16;
            if (currentY + curHeight + nextEstimatedFirstLineHeight > contentHeight) {
              onColumnOrPageOverflow();
              ensurePendingFootnoteSpace();
            }
          }

          this.layoutParagraph(
            block,
            getActiveColWidth(),
            effectiveContentHeight,
            dynamicMargins,
            (line) => {
              currentLines.push(line);
            },
            () => {
              blockOverflow();
            },
            () => currentY,
            (newY) => {
              currentY = newY;
            },
            () => {
              scanPlacedFootnoteRefs();
              emitPage();
              ensurePendingFootnoteSpace();
            },
            () => {
              blockOverflow();
            },
            {
              pageWidthPt: pageSize.width,
              pageHeightPt: pageSize.height,
              getPageIndex: () => currentPageIndex,
              getColumnWidthPt: () => getActiveColWidth(),
            },
          );
        } else if (block.type === 'table') {
          this.layoutTable(
            block,
            getActiveColWidth(),
            effectiveContentHeight,
            dynamicMargins,
            (line) => {
              currentLines.push(line);
            },
            () => {
              blockOverflow();
            },
            () => currentY,
            (newY) => {
              currentY = newY;
            },
            (cellBox) => {
              currentCellBoxes.push(cellBox);
            },
          );
        } else if (block.type === 'drawing') {
          if (currentY + block.heightPt > contentHeight && (currentLines.length > 0 || currentColumnIndex > 0)) {
            onColumnOrPageOverflow();
          }
          currentLines.push({
            bounds: {
              x: getActiveColStartX(),
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
          if (currentY + block.heightPt > contentHeight && (currentLines.length > 0 || currentColumnIndex > 0)) {
            onColumnOrPageOverflow();
          }
          currentLines.push({
            bounds: {
              x: getActiveColStartX(),
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

      if (currentLines.length > 0 || currentCellBoxes.length > 0 || pages.length === 0) {
        emitPage();
      }
    }

    // Second pass, part 1: resolve footnotes referenced on each page. An
    // oversized footnote block is split across inserted continuation pages
    // (F-FNOTE-PAG pagination); indices and totals are fixed up afterwards,
    // before headers/footers resolve against final physical pagination.
    this.attachFootnotes(pages, pageMetas, document);
    for (let pIdx = 0; pIdx < pages.length; pIdx++) {
      pages[pIdx]!.pageIndex = pIdx;
      pages[pIdx]!.totalPageCount = pages.length;
    }

    // Second pass, part 2: attach headerLines and footerLines with resolved totalPages and page numbers
    const totalPages = pages.length;
    for (let mIdx = 0; mIdx < pageMetas.length; mIdx++) {
      const meta = pageMetas[mIdx]!;
      const { page, section, sectionPageIndex } = meta;
      const contentWidth = Math.max(50, page.size.width - page.margins.left - page.margins.right);
      const pageNumStr = page.formattedPageNumber ?? String(page.pageNumber);

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
        page.headerLines = this.layoutHeaderFooter(headerNode, contentWidth, headerDist, page.margins, pageNumStr, totalPages);
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
        page.footerLines = this.layoutHeaderFooter(footerNode, contentWidth, footerY, page.margins, pageNumStr, totalPages);
      }
    }

    return pages;
  }

  /**
   * Attaches footnote lines to the pages whose body references them
   * (F-FNOTE-PAG). A block that fits is bottom-anchored below the reserved
   * body zone; a block that overruns the page starts below the body and its
   * excess lines flow to inserted footnote-continuation pages, so neither
   * body nor footnote content ever overlaps or leaves the content area.
   */
  private attachFootnotes(
    pages: PageLayout[],
    pageMetas: { page: PageLayout; section: SectionNode; sectionPageIndex: number }[],
    document: DocumentNode,
  ): void {
    const footnoteById = new Map<number, FootnoteNode>();
    for (const fn of document.footnotes ?? []) {
      if (fn.kind === 'footnote') footnoteById.set(fn.id, fn);
    }
    if (footnoteById.size === 0) return;

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i]!;
      const meta = pageMetas[i]!;
      const referencedIds: number[] = [];
      const seen = new Set<number>();
      for (const line of page.lines) {
        for (const frag of line.fragments) {
          const ref = frag.footnoteRef;
          if (ref && ref.kind === 'footnote' && footnoteById.has(ref.id) && !seen.has(ref.id)) {
            seen.add(ref.id);
            referencedIds.push(ref.id);
          }
        }
      }
      if (referencedIds.length === 0) continue;

      const contentWidth = Math.max(50, page.size.width - page.margins.left - page.margins.right);
      const raw = this.buildFootnoteRawLines(
        referencedIds.map((id) => footnoteById.get(id)!),
        contentWidth,
      );
      if (raw.length === 0) continue;

      const contentBottom = page.size.height - page.margins.bottom;
      let bodyBottom = page.margins.top;
      for (const line of page.lines) {
        bodyBottom = Math.max(bodyBottom, line.bounds.y + line.bounds.height);
      }
      const total = raw.reduce((acc, l) => acc + l.bounds.height, 0);
      const fitsBelow = FOOTNOTE_SEPARATOR_GAP_PT + total <= contentBottom - bodyBottom;
      const firstTop = fitsBelow ? contentBottom - total : bodyBottom + FOOTNOTE_SEPARATOR_GAP_PT;

      // Split the block across continuation pages when it overruns the page.
      // The `cur.length > 0` guard keeps a single over-tall line on its own
      // page instead of looping forever.
      const chunks: LayoutLine[][] = [[]];
      for (const line of raw) {
        const cap = chunks.length === 1 ? contentBottom - firstTop : contentBottom - page.margins.top;
        const cur = chunks[chunks.length - 1]!;
        const used = cur.reduce((acc, l) => acc + l.bounds.height, 0);
        if (cur.length > 0 && used + line.bounds.height > cap) chunks.push([]);
        chunks[chunks.length - 1]!.push(line);
      }

      const positionChunk = (chunk: LayoutLine[], topY: number): LayoutLine[] => {
        let y = 0;
        return chunk.map((line) => {
          const out: LayoutLine = {
            bounds: {
              x: page.margins.left + line.bounds.x,
              y: topY + y + line.bounds.y,
              width: line.bounds.width,
              height: line.bounds.height,
            },
            baseline: line.baseline,
            fragments: line.fragments,
          };
          y += line.bounds.height;
          return out;
        });
      };

      page.footnoteLines = positionChunk(chunks[0]!, firstTop);
      // Continuation pages share the ref page's logical number: they are a
      // physical overflow of the same numbered page, not new numbered pages.
      for (let c = 1; c < chunks.length; c++) {
        const contPage: PageLayout = {
          pageIndex: -1,
          pageNumber: page.pageNumber,
          formattedPageNumber: page.formattedPageNumber,
          orientation: page.orientation,
          size: { ...page.size },
          margins: { ...page.margins },
          lines: [],
          footnoteLines: positionChunk(chunks[c]!, page.margins.top),
        };
        pages.splice(i + c, 0, contPage);
        pageMetas.splice(i + c, 0, { page: contPage, section: meta.section, sectionPageIndex: meta.sectionPageIndex });
      }
    }
  }

  /**
   * Breaks footnote bodies into raw (relative-coordinate) lines. Shared by
   * reservation measurement and final attachment so both agree exactly.
   */
  private buildFootnoteRawLines(footnotes: FootnoteNode[], contentWidth: number): LayoutLine[] {
    const rawLines: LayoutLine[] = [];
    for (const fn of footnotes) {
      for (const block of fn.children) {
        if (block.type === 'paragraph') {
          const pLines = this.lineBreaker.breakParagraph(block, contentWidth);
          for (const l of pLines) rawLines.push(l);
        }
      }
    }
    return rawLines;
  }

  private layoutHeaderFooter(
    node: HeaderFooterNode,
    contentWidth: number,
    baseY: number,
    margins: Margins,
    pageNumStr: string,
    totalPages: number,
  ): LayoutLine[] {
    const lines: LayoutLine[] = [];
    let currentY = 0;

    for (const block of node.children) {
      if (block.type === 'paragraph') {
        const resolvedParagraph = this.resolveFields(block, pageNumStr, totalPages);
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

  private resolveFields(p: ParagraphNode, pageNumStr: string, totalPages: number): ParagraphNode {
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

  /**
   * Repositions floating (`wp:anchor`) image fragments at their anchor
   * position. Their tokens consume no inline flow, so without this they
   * would pile up at the line start; with it they overlay the page at the
   * authored position. Both `w:posOffset` and `w:align` placements resolve
   * here (F-ANCHOR); text wrapping around floats is not modeled.
   * Fragment bounds stay relative to the line (the renderer adds the
   * line origin), so the absolute page-space target is converted back.
   */
  private resolveFloatingFragments(
    pageLine: LayoutLine,
    margins: Margins,
    paragraphTop: number,
    anchorCtx?: FloatingAnchorContext,
  ): void {
    for (const frag of pageLine.fragments) {
      const anchor = frag.image?.anchor;
      if (!anchor) continue;
      const imgW = frag.image!.widthPt;
      const imgH = frag.image!.heightPt;
      const fromH = anchor.horizontalFrom.toLowerCase();
      const fromV = anchor.verticalFrom.toLowerCase();
      const columnW = anchorCtx?.getColumnWidthPt() ?? 0;

      // Horizontal reference edge and width.
      let baseX: number;
      let refW: number;
      if (fromH === 'page') {
        baseX = 0;
        refW = anchorCtx?.pageWidthPt ?? 0;
      } else if (fromH === 'margin') {
        baseX = 0;
        refW = Math.max(0, (anchorCtx?.pageWidthPt ?? 0) - margins.left - margins.right);
      } else if (fromH === 'character') {
        baseX = pageLine.bounds.x + frag.bounds.x;
        refW = columnW;
      } else {
        // 'column' (default) and 'paragraph': full column width.
        baseX = margins.left;
        refW = columnW;
      }

      // Physical page 1, 3, 5... (0-based even index) are recto: inside
      // binds to the left edge there, outside to the right edge.
      const pageIndex = anchorCtx?.getPageIndex() ?? 0;
      const isRecto = pageIndex % 2 === 0;
      const alignH = anchor.horizontalAlign?.toLowerCase();
      const rightEdge =
        alignH === 'right' || (alignH === 'outside' && isRecto) || (alignH === 'inside' && !isRecto);
      let absX: number;
      if (alignH === 'center') {
        absX = baseX + (refW - imgW) / 2;
      } else if (rightEdge) {
        absX = baseX + refW - imgW;
      } else if (alignH) {
        absX = baseX; // left, inside on recto, or unknown keyword: reference edge
      } else {
        absX = baseX + anchor.horizontalOffsetPt;
      }

      // Vertical reference edge and height. Paragraph-relative alignment
      // has no measurable reference height at resolve time (the paragraph
      // is still being laid out), so vertical aligns there pin to the
      // paragraph top — a documented approximation.
      let baseY: number;
      let refH: number | undefined;
      if (fromV === 'page') {
        baseY = 0;
        refH = anchorCtx?.pageHeightPt ?? 0;
      } else if (fromV === 'margin') {
        baseY = margins.top;
        refH = (anchorCtx?.pageHeightPt ?? 0) - margins.top - margins.bottom;
      } else if (fromV === 'line') {
        baseY = pageLine.bounds.y;
        refH = pageLine.bounds.height;
      } else {
        baseY = margins.top + paragraphTop; // paragraph (default)
        refH = undefined;
      }

      const alignV = anchor.verticalAlign?.toLowerCase();
      let absY: number;
      if (alignV === 'center' && refH !== undefined) {
        absY = baseY + (refH - imgH) / 2;
      } else if ((alignV === 'bottom' || alignV === 'outside') && refH !== undefined) {
        absY = baseY + refH - imgH;
      } else if (alignV) {
        absY = baseY;
      } else {
        absY = baseY + anchor.verticalOffsetPt;
      }

      frag.bounds.x = absX - pageLine.bounds.x;
      frag.bounds.y = absY - pageLine.bounds.y;
      frag.bounds.width = imgW;
      frag.bounds.height = imgH;
    }
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
    onPageBreak?: () => void,
    onColumnBreak?: () => void,
    anchorCtx?: FloatingAnchorContext,
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

    // The authored line spacing acts as the minimum vertical advance per
    // line (atLeast semantics — the serializer emits the same rule, v2 N9).
    // Without this, exact-spaced documents pack ~2x too many lines per page.
    const minAdvance = p.style?.lineSpacingPt ?? 0;
    const advanceOf = (height: number): number => Math.max(height, minAdvance);

    // Page-space top of this paragraph's first line on the current page.
    // Floating images anchored relative to the paragraph resolve against it.
    let paragraphTop = y;
    const markOverflow = (): void => {
      paragraphTop = 0;
    };

    // If keepLines is requested, check if all lines fit on current page/column
    if (p.style?.keepLines && y > 0 && lines.length > 1) {
      const totalParagraphHeight = lines.reduce((acc, l) => acc + advanceOf(l.bounds.height), 0);
      if (y + totalParagraphHeight > contentHeight) {
        onPageOverflow();
        y = 0;
        markOverflow();
      }
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const advance = advanceOf(line.bounds.height);
      if (y + advance > contentHeight && y > 0) {
        onPageOverflow();
        y = 0;
        markOverflow();
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
        breakType: line.breakType,
      };

      this.resolveFloatingFragments(pageLine, margins, paragraphTop, anchorCtx);
      pushLine(pageLine);
      y += advance;

      // Handle explicit break on the line
      if (line.breakType === 'page') {
        if (onPageBreak) {
          onPageBreak();
        } else {
          onPageOverflow();
        }
        y = 0;
        markOverflow();
      } else if (line.breakType === 'column') {
        if (onColumnBreak) {
          onColumnBreak();
        } else {
          onPageOverflow();
        }
        y = 0;
        markOverflow();
      }
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
    pushCellBox?: (cell: CellBox) => void,
    depth = 0,
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

    // Leading consecutive tblHeader rows repeat at the top of every page
    // the table spans (F-TBLHDR). Implemented as queue splicing: on
    // overflow past a body row, the header indices are re-queued ahead of
    // it and flow through the normal layout+emit path with fresh
    // coordinates. Nested tables never paginate (their overflow callback
    // is a no-op), so repetition is top-level only.
    let headerRowCount = 0;
    while (headerRowCount < rowCount && table.rows[headerRowCount]?.tblHeader) headerRowCount++;

    const rowQueue: number[] = [];
    for (let i = 0; i < rowCount; i++) rowQueue.push(i);
    let q = 0;
    while (q < rowQueue.length) {
      const rIndex = rowQueue[q]!;
      const row = table.rows[rIndex]!;
      const cellCount = row.children.length;
      if (cellCount === 0) {
        q++;
        continue;
      }

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

        // Skip layout for continuation cells in vertical merge: the merged
        // region paints once from the restart cell's box (F-TABSPAN, by design).
        if (cell.vMerge === 'continue' || cell.rowSpan === 0) {
          cellLinesMap.push([]);
          cellContentHeights.push(0);
          continue;
        }

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
          } else if (child.type === 'table') {
            let nestedY = cellY;
            this.layoutTable(
              child,
              innerWidth,
              contentHeight,
              { top: 0, bottom: 0, left: 0, right: 0 },
              (nestedLine) => {
                cellLines.push({
                  bounds: {
                    x: nestedLine.bounds.x,
                    y: nestedLine.bounds.y,
                    width: nestedLine.bounds.width,
                    height: nestedLine.bounds.height,
                  },
                  fragments: nestedLine.fragments,
                  baseline: nestedLine.baseline,
                });
              },
              () => {},
              () => nestedY,
              (newY) => {
                nestedY = newY;
              },
              pushCellBox
                ? (nestedCell) => {
                    pushCellBox({
                      ...nestedCell,
                      bounds: {
                        x: cellXPositions[c]! + padLeft + nestedCell.bounds.x,
                        y: margins.top + y + padTop + nestedCell.bounds.y,
                        width: nestedCell.bounds.width,
                        height: nestedCell.bounds.height,
                      },
                    });
                  }
                : undefined,
              depth + 1,
            );
            cellY = nestedY;
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

      // Check page break for row. When a body row overflows, re-queue
      // the leading header rows ahead of it so they repeat at the top of
      // the new page; the loop re-processes from the first header with a
      // clean y. Header rows themselves flow through normally (no splice),
      // which also guarantees termination.
      if (y + rowHeight > contentHeight && y > 0) {
        onPageOverflow();
        y = 0;
        if (depth === 0 && headerRowCount > 0 && rIndex >= headerRowCount) {
          for (let h = headerRowCount - 1; h >= 0; h--) rowQueue.splice(q, 0, h);
          continue;
        }
      }

      const isFirstRow = rIndex === 0;
      const isLastRow = rIndex === rowCount - 1;

      // Place cell lines and cell boxes into page with vertical alignment applied
      for (let c = 0; c < cellCount; c++) {
        const cell = row.children[c]!;
        const cellX = cellXPositions[c]!;
        const cellW = cellWidths[c]!;
        const lines = cellLinesMap[c] ?? [];
        const pad = cellPaddings[c]!;
        const contentH = cellContentHeights[c]!;
        const vAlign = cell.style?.verticalAlign ?? 'top';

        const isFirstCol = c === 0;
        const isLastCol = c === cellCount - 1;

        if (pushCellBox) {
          const bg = cell.style?.backgroundColor;
          const bTop = parseBorderStyle(cell.style?.borderTop ?? (isFirstRow ? table.style?.borderTop : table.style?.borderInsideH));
          const bBottom = parseBorderStyle(cell.style?.borderBottom ?? (isLastRow ? table.style?.borderBottom : table.style?.borderInsideH));
          const bLeft = parseBorderStyle(cell.style?.borderLeft ?? (isFirstCol ? table.style?.borderLeft : table.style?.borderInsideV));
          const bRight = parseBorderStyle(cell.style?.borderRight ?? (isLastCol ? table.style?.borderRight : table.style?.borderInsideV));

          if (bg || bTop || bBottom || bLeft || bRight) {
            pushCellBox({
              bounds: {
                x: cellX,
                y: margins.top + y,
                width: cellW,
                height: rowHeight,
              },
              backgroundColor: bg,
              borderTop: bTop,
              borderBottom: bBottom,
              borderLeft: bLeft,
              borderRight: bRight,
            });
          }
        }

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
      q++;
    }

    setY(y);
  }
}

export const defaultPageEngine = new StandardPageEngine();
