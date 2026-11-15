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
import type { ParagraphStyle } from '../types/style.js';
import { hostDocumentBlockFloats } from '../types/block-floats.js';
import {
  defaultLineBreaker,
  layoutTextboxLines,
  type LayoutLine,
  type LineBreakOptions,
  type LineBreaker,
  type LineFragment,
} from './line-breaker.js';

/**
 * Geometric layout and pagination model according to ISO/IEC 29500-1.
 */

export interface BorderStyle {
  style?: string; // 'single' | 'dashed' | 'dotted' | 'double' | 'wave' | 'none';
  widthPt?: number;
  color?: string;
}

/**
 * Box an anchor keyword resolves against, in the coordinate space of the
 * lines being laid out. Height is omitted when it is not known yet (a
 * table cell still being filled): vertical keywords then pin to the top.
 */
export interface AnchorReferenceBox {
  x: number;
  y: number;
  width: number;
  height?: number;
}

/**
 * Reference geometry for resolving floating-image anchors (F-ANCHOR).
 * The page and margin boxes are explicit so a host other than the page
 * (a table cell) can offer its own content box for both axes; the page
 * index and column width are read live because pages and columns turn
 * over mid-paragraph.
 *
 * Part of the public type surface (re-exported from the package entry),
 * but no public method takes or returns it; its shape follows the
 * anchor model and changes are recorded in CHANGELOG as breaking.
 */
export interface FloatingAnchorContext {
  /** What `relativeFrom="page"` means here. */
  pageBox: AnchorReferenceBox;
  /** What `relativeFrom="margin"` means here; its origin is also the paragraph origin. */
  marginBox: AnchorReferenceBox;
  getPageIndex: () => number;
  getColumnWidthPt: () => number;
  /** Left edge of the active column, for `relativeFrom="column"`. */
  getColumnStartXPt: () => number;
  /**
   * For a table cell: runs `resolve` with the host page expressed in this
   * cell's coordinates once the cell has its final page position (after
   * row overflow and vertical cell alignment). Floats with
   * `layoutInCell="0"` use it, since their page/margin references mean
   * the real page rather than the cell.
   */
  resolveOutsideCell?: (resolve: (hostCtx: FloatingAnchorContext) => void) => void;
}

/** Anchor context for lines laid out on a real page. */
function pageAnchorContext(
  pageSize: Size,
  margins: Margins,
  getPageIndex: () => number,
  getColumnWidthPt: () => number,
  getColumnStartXPt: () => number = () => margins.left,
): FloatingAnchorContext {
  return {
    pageBox: { x: 0, y: 0, width: pageSize.width, height: pageSize.height },
    marginBox: {
      x: margins.left,
      y: margins.top,
      width: Math.max(0, pageSize.width - margins.left - margins.right),
      height: Math.max(0, pageSize.height - margins.top - margins.bottom),
    },
    getPageIndex,
    getColumnWidthPt,
    getColumnStartXPt,
  };
}

/** The same context seen from a coordinate space whose origin sits at (-dx, -dy). */
function shiftAnchorContext(ctx: FloatingAnchorContext, dx: number, dy: number): FloatingAnchorContext {
  return {
    pageBox: { ...ctx.pageBox, x: ctx.pageBox.x + dx, y: ctx.pageBox.y + dy },
    marginBox: { ...ctx.marginBox, x: ctx.marginBox.x + dx, y: ctx.marginBox.y + dy },
    getPageIndex: ctx.getPageIndex,
    getColumnWidthPt: ctx.getColumnWidthPt,
    getColumnStartXPt: () => ctx.getColumnStartXPt() + dx,
  };
}

/**
 * Vertical advance of one line under the paragraph's `w:spacing` rule
 * (§17.3.1.33): `auto` scales the line's own height by the multiple,
 * `atLeast` is a floor, `exact` replaces it, `atMost` caps it. A point
 * value without a rule (hand-built ASTs, older serializations) is a floor.
 */
function lineAdvance(style: ParagraphStyle | undefined, naturalHeight: number): number {
  const pt = style?.lineSpacingPt;
  const rule = style?.lineSpacingRule ?? (pt !== undefined ? 'atLeast' : 'auto');
  switch (rule) {
    case 'exact':
      return pt ?? naturalHeight;
    case 'atLeast':
      return Math.max(naturalHeight, pt ?? 0);
    case 'atMost':
      return pt === undefined ? naturalHeight : Math.min(naturalHeight, pt);
    default:
      return naturalHeight * (style?.lineSpacingMultiple ?? 1);
  }
}

/**
 * Space before and after a paragraph. With `w:contextualSpacing` the
 * space facing a neighbour of the same paragraph style is dropped
 * (§17.3.1.9), which is how list items authored in List Paragraph sit
 * flush against each other.
 */
function paragraphSpacing(
  p: ParagraphNode,
  prev: BlockNode | undefined,
  next: BlockNode | undefined,
): { before: number; after: number } {
  const contextual = p.style?.contextualSpacing === true;
  const sameStyle = (other: BlockNode | undefined): boolean =>
    other?.type === 'paragraph' && (other.styleId ?? '') === (p.styleId ?? '');
  return {
    before: contextual && sameStyle(prev) ? 0 : (p.style?.spaceBeforePt ?? 0),
    after: contextual && sameStyle(next) ? 0 : (p.style?.spaceAfterPt ?? 0),
  };
}

function lineHasFloat(line: LayoutLine): boolean {
  return line.fragments.some((f) => (f.image?.anchor ?? f.drawing?.anchor) !== undefined);
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
  /** Document settings for the active layoutDocument call (tab grid). */
  private breakOptions: LineBreakOptions | undefined;

  constructor(lineBreaker: LineBreaker = defaultLineBreaker) {
    this.lineBreaker = lineBreaker;
  }

  layoutDocument(input: DocumentNode): PageLayout[] {
    // Block-level floats become their empty host paragraph once, here, so
    // every block loop below sees only paragraphs and tables (F-HTMLFLOAT).
    const document = hostDocumentBlockFloats(input);
    this.breakOptions = document.settings?.defaultTabStopPt !== undefined ? { defaultTabStopPt: document.settings.defaultTabStopPt } : undefined;
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

      // A page resumed across a continuous break keeps the section it
      // started in for header/footer resolution (F-HDRSEC): the resumed
      // page still carries the previous section's content, so the first
      // section on the page wins its header/footer. One-shot — later
      // pages in this section use the current section.
      let pendingResumeSection = resumedMeta?.section;

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
        pageMetas.push({ page, section: pendingResumeSection ?? section, sectionPageIndex });
        pendingResumeSection = undefined;
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

      const bodyAnchorCtx = pageAnchorContext(pageSize, margins, () => currentPageIndex, getActiveColWidth, getActiveColStartX);

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
            const curLines = this.lineBreaker.breakParagraph(block, getActiveColWidth(), this.breakOptions);
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
            bodyAnchorCtx,
            () => {
              scanPlacedFootnoteRefs();
              emitPage();
              ensurePendingFootnoteSpace();
            },
            () => {
              blockOverflow();
            },
            { prev: section.children[bIndex - 1], next: section.children[bIndex + 1] },
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
            0,
            () => bodyAnchorCtx,
          );
        } else if (block.type === 'drawing') {
          if (currentY + block.heightPt > contentHeight && (currentLines.length > 0 || currentColumnIndex > 0)) {
            onColumnOrPageOverflow();
          }
          const blockDrawingFragment: LineFragment = {
            text: '',
            drawing: block,
            bounds: { x: 0, y: 0, width: block.widthPt, height: block.heightPt },
          };
          currentLines.push({
            bounds: {
              x: getActiveColStartX(),
              y: margins.top + currentY,
              width: block.widthPt,
              height: block.heightPt,
            },
            fragments: [blockDrawingFragment],
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
    // Sections without their own header/footer inherit the previous
    // section's ("same as previous" is Word's default linkage).
    const findPart = (
      slot: 'headers' | 'footers',
      sIdx: number,
      kind: 'first' | 'even' | 'default',
    ): HeaderFooterNode | undefined => {
      for (let i = sIdx; i >= 0; i--) {
        const node = document.sections[i]?.[slot]?.[kind];
        if (node) return node;
      }
      return undefined;
    };
    const resolvePart = (
      slot: 'headers' | 'footers',
      sIdx: number,
      section: SectionNode,
      sectionPageIndex: number,
      pageIndex: number,
    ): HeaderFooterNode | undefined => {
      if (sectionPageIndex === 0 && section.properties.titlePg) {
        const first = findPart(slot, sIdx, 'first');
        if (first) return first;
      }
      // true: use even parts; false (parsed package without the setting):
      // ignore them; undefined (hand-built AST): an even part present
      // means use it (F-HDREVEN).
      if (pageIndex % 2 === 1 && section.properties.evenAndOddHeaders !== false) {
        const even = findPart(slot, sIdx, 'even');
        if (even) return even;
      }
      return findPart(slot, sIdx, 'default');
    };
    const totalPages = pages.length;
    for (let mIdx = 0; mIdx < pageMetas.length; mIdx++) {
      const meta = pageMetas[mIdx]!;
      const { page, section, sectionPageIndex } = meta;
      const sIdx = document.sections.indexOf(section);
      const contentWidth = Math.max(50, page.size.width - page.margins.left - page.margins.right);
      const pageNumStr = page.formattedPageNumber ?? String(page.pageNumber);

      // 1. Resolve header
      const headerNode = resolvePart('headers', sIdx, section, sectionPageIndex, page.pageIndex);

      if (headerNode) {
        const headerDist = section.properties.headerDistancePt ?? 36;
        page.headerLines = this.layoutHeaderFooter(headerNode, contentWidth, headerDist, page.margins, pageNumStr, totalPages, page.size.width, page.size.height, page.pageIndex);
      }

      // 2. Resolve footer
      const footerNode = resolvePart('footers', sIdx, section, sectionPageIndex, page.pageIndex);

      if (footerNode) {
        const footerDist = section.properties.footerDistancePt ?? 36;
        const footerY = page.size.height - footerDist - 16;
        page.footerLines = this.layoutHeaderFooter(footerNode, contentWidth, footerY, page.margins, pageNumStr, totalPages, page.size.width, page.size.height, page.pageIndex);
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
          const pLines = this.lineBreaker.breakParagraph(block, contentWidth, this.breakOptions);
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
    pageWidthPt: number,
    pageHeightPt: number,
    pageIndex: number,
  ): LayoutLine[] {
    const lines: LayoutLine[] = [];
    let currentY = 0;
    const anchorCtx = pageAnchorContext(
      { width: pageWidthPt, height: pageHeightPt },
      margins,
      () => pageIndex,
      () => contentWidth,
    );

    for (let i = 0; i < node.children.length; i++) {
      const block = node.children[i]!;
      if (block.type === 'paragraph') {
        const resolvedParagraph = this.resolveFields(block, pageNumStr, totalPages);
        const pLines = this.lineBreaker.breakParagraph(resolvedParagraph, contentWidth, this.breakOptions);
        // Paragraph spacing and line rule apply here as in the body.
        const { before, after } = paragraphSpacing(block, node.children[i - 1], node.children[i + 1]);
        if (currentY > 0) currentY += before;
        // Content-relative top of this paragraph: floating fragments in
        // headers/footers resolve against it exactly like body floats
        // (F-HDRFLOAT), otherwise anchored shapes pile up inline.
        const paragraphTop = baseY + currentY - margins.top;
        for (const line of pLines) {
          const pageLine: LayoutLine = {
            bounds: {
              x: margins.left + line.bounds.x,
              y: baseY + currentY + line.bounds.y,
              width: line.bounds.width,
              height: line.bounds.height,
            },
            baseline: line.baseline,
            fragments: line.fragments,
          };
          this.resolveFloatingFragments(pageLine, paragraphTop, anchorCtx);
          lines.push(pageLine);
          currentY += lineAdvance(block.style, line.bounds.height);
        }
        currentY += after;
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
  private resolveFloatingFragments(pageLine: LayoutLine, paragraphTop: number, anchorCtx: FloatingAnchorContext): void {
    for (const frag of pageLine.fragments) {
      const anchor = frag.image?.anchor ?? frag.drawing?.anchor;
      if (!anchor) continue;
      // The paragraph top in the line's own coordinate space; it belongs
      // to the line's host whichever context resolves the float.
      const paragraphY = anchorCtx.marginBox.y + paragraphTop;
      // An ordinary cell float resolves against the cell. With
      // layoutInCell="0" the object is laid out as if outside the cell:
      // page, margin, column, and page index all come from the host, whose
      // place relative to the cell is only known once the row is placed
      // (it may move to the next page, and vertical cell alignment shifts
      // the content). That resolution is deferred to the host; the in-cell
      // placement stands in until it runs, without laying out the shape
      // text twice (F-TBXFLOAT).
      const deferred = anchor.layoutInCell === false && anchorCtx.resolveOutsideCell !== undefined;
      this.placeFloatingFragment(frag, pageLine, paragraphY, anchorCtx, !deferred);
      if (deferred) {
        anchorCtx.resolveOutsideCell!((hostCtx) => this.placeFloatingFragment(frag, pageLine, paragraphY, hostCtx, true));
      }
    }
  }

  /**
   * Places one floating fragment against `ctx`, expressed in the line's
   * coordinate space. `paragraphY` is the top of the line's paragraph in
   * that same space. `layoutText` is false for a stand-in placement that
   * a deferred one will replace.
   */
  private placeFloatingFragment(
    frag: LineFragment,
    pageLine: LayoutLine,
    paragraphY: number,
    ctx: FloatingAnchorContext,
    layoutText: boolean,
  ): void {
    const anchor = frag.image?.anchor ?? frag.drawing?.anchor;
    if (!anchor) return;
    const imgW = frag.image?.widthPt ?? frag.drawing?.widthPt ?? 0;
    const imgH = frag.image?.heightPt ?? frag.drawing?.heightPt ?? 0;
    const fromH = anchor.horizontalFrom.toLowerCase();
    const fromV = anchor.verticalFrom.toLowerCase();
    const columnW = ctx.getColumnWidthPt();

    // Horizontal reference edge and width.
    let baseX: number;
    let refW: number;
    if (fromH === 'page') {
      baseX = ctx.pageBox.x;
      refW = ctx.pageBox.width;
    } else if (fromH === 'margin') {
      baseX = ctx.marginBox.x;
      refW = ctx.marginBox.width;
    } else if (fromH === 'character') {
      baseX = pageLine.bounds.x + frag.bounds.x;
      refW = columnW;
    } else {
      // 'column' (default) and 'paragraph': full column width.
      baseX = ctx.getColumnStartXPt();
      refW = columnW;
    }

    // Physical page 1, 3, 5... (0-based even index) are recto: inside
    // binds to the left edge there, outside to the right edge.
    const pageIndex = ctx.getPageIndex();
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
    // paragraph top — a documented approximation. A reference box
    // without a height (a cell still being filled) pins the same way.
    let baseY: number;
    let refH: number | undefined;
    if (fromV === 'page') {
      baseY = ctx.pageBox.y;
      refH = ctx.pageBox.height;
    } else if (fromV === 'margin') {
      baseY = ctx.marginBox.y;
      refH = ctx.marginBox.height;
    } else if (fromV === 'line') {
      baseY = pageLine.bounds.y;
      refH = pageLine.bounds.height;
    } else {
      baseY = paragraphY; // paragraph (default)
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

    if (layoutText) this.layoutShapeText(frag, imgW);
  }

  /**
   * Lays floating shape textbox content inside the shape frame (DrawingML
   * bodyPr default insets) instead of joining the flow, so banners keep
   * their authored text without pushing later paragraphs down
   * (F-TBXFLOAT). Runs from float resolution, so it covers body,
   * header/footer, and table-cell lines alike.
   */
  private layoutShapeText(frag: LineFragment, shapeWidthPt: number): void {
    const drawing = frag.drawing;
    // Only floating shapes keep their text in the frame; inline shapes
    // drained it into the flow on parse, and the HTML renderer applies
    // the same gate, so neither renderer paints it twice (F-TBXFLOAT).
    if (!drawing?.anchor || !drawing.textbox || drawing.textbox.length === 0) return;
    frag.shapeText = layoutTextboxLines(this.lineBreaker, drawing.textbox, shapeWidthPt);
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
    anchorCtx: FloatingAnchorContext,
    onPageBreak?: () => void,
    onColumnBreak?: () => void,
    neighbours?: { prev?: BlockNode; next?: BlockNode },
  ): void {
    const { before: spaceBefore, after: spaceAfter } = paragraphSpacing(p, neighbours?.prev, neighbours?.next);

    let y = getY();
    if (y > 0 && spaceBefore > 0) {
      if (y + spaceBefore > contentHeight) {
        onPageOverflow();
        y = 0;
      } else {
        y += spaceBefore;
      }
    }

    const lines = this.lineBreaker.breakParagraph(p, contentWidth, this.breakOptions);

    const advanceOf = (height: number): number => lineAdvance(p.style, height);

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

      this.resolveFloatingFragments(pageLine, paragraphTop, anchorCtx);
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
    getAnchorCtx?: () => FloatingAnchorContext,
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
      // Per cell: layoutInCell="0" floats waiting for the cell's final
      // page position (F-TBXFLOAT).
      const cellOutsideResolvers: ((hostCtx: FloatingAnchorContext) => void)[][] = [];

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
          cellOutsideResolvers.push([]);
          continue;
        }

        const innerWidth = Math.max(10, cellW - padLeft - padRight);
        const cellLines: LayoutLine[] = [];
        let cellY = 0;
        // Floating drawings inside a cell resolve against the cell content
        // box on both axes: column, margin, and page references all mean
        // the cell here. Its height is unknown until the cell is filled,
        // so vertical keywords pin to the cell top rather than resolving
        // against the host page and landing a page below. The page index
        // comes from the host so inside/outside keep their side
        // (F-TBXFLOAT). Built on the first float only, nested tables
        // included (they take the thunk); most cells have none. A
        // layoutInCell="0" float registers a resolver that the placement
        // pass runs once the cell's page position is final.
        const outsideResolvers: ((hostCtx: FloatingAnchorContext) => void)[] = [];
        cellOutsideResolvers.push(outsideResolvers);
        let cellAnchorCtx: FloatingAnchorContext | undefined;
        const getCellAnchorCtx = (): FloatingAnchorContext => {
          if (cellAnchorCtx) return cellAnchorCtx;
          const cellBox: AnchorReferenceBox = { x: 0, y: 0, width: innerWidth };
          cellAnchorCtx = {
            pageBox: cellBox,
            marginBox: cellBox,
            getPageIndex: () => getAnchorCtx?.().getPageIndex() ?? 0,
            getColumnWidthPt: () => innerWidth,
            getColumnStartXPt: () => 0,
            resolveOutsideCell: getAnchorCtx ? (resolve) => outsideResolvers.push(resolve) : undefined,
          };
          return cellAnchorCtx;
        };

        for (let ci = 0; ci < cell.children.length; ci++) {
          const child = cell.children[ci]!;
          if (child.type === 'paragraph') {
            // Cell paragraphs keep their spacing and line rule; Word
            // applies space-before even at the top of a cell.
            const { before, after } = paragraphSpacing(child, cell.children[ci - 1], cell.children[ci + 1]);
            cellY += before;
            const pLines = this.lineBreaker.breakParagraph(child, innerWidth, this.breakOptions);
            const paragraphTop = cellY;
            for (const pl of pLines) {
              const cellLine: LayoutLine = {
                bounds: {
                  x: pl.bounds.x,
                  y: cellY + pl.bounds.y,
                  width: pl.bounds.width,
                  height: pl.bounds.height,
                },
                fragments: pl.fragments,
                baseline: pl.baseline,
              };
              if (lineHasFloat(cellLine)) this.resolveFloatingFragments(cellLine, paragraphTop, getCellAnchorCtx());
              cellLines.push(cellLine);
              cellY += lineAdvance(child.style, pl.bounds.height);
            }
            cellY += after;
          } else if (child.type === 'drawing') {
            const drawingFragment: LineFragment = {
              text: '',
              drawing: child,
              bounds: { x: 0, y: 0, width: child.widthPt, height: child.heightPt },
            };
            cellLines.push({
              bounds: {
                x: 0,
                y: cellY,
                width: child.widthPt,
                height: child.heightPt,
              },
              fragments: [drawingFragment],
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
              getCellAnchorCtx,
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

        // The cell content box now has its final origin on the host (row
        // overflow and vertical alignment applied), so layoutInCell="0"
        // floats can reach the real page from cell space. A nested table's
        // cell chains through its host cell, so the shift composes up to
        // the page (F-TBXFLOAT).
        const outsideResolvers = cellOutsideResolvers[c] ?? [];
        const hostCtx = outsideResolvers.length > 0 ? getAnchorCtx?.() : undefined;
        if (hostCtx) {
          const originX = cellX + pad.left;
          const originY = margins.top + y + vOffset;
          const resolveFromHost = (host: FloatingAnchorContext): void => {
            const hostInCell = shiftAnchorContext(host, -originX, -originY);
            for (const resolve of outsideResolvers) resolve(hostInCell);
          };
          if (hostCtx.resolveOutsideCell) hostCtx.resolveOutsideCell(resolveFromHost);
          else resolveFromHost(hostCtx);
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
