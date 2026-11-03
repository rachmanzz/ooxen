import type { FootnoteReference, ParagraphNode, RevisionInfo, RunNode } from '../types/ast.js';
import type { TextStyle } from '../types/style.js';

/**
 * Compares two TextStyle objects for equality to allow coalescing.
 */
function areTextStylesEqual(a?: TextStyle, b?: TextStyle): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;

  return (
    a.fontFamily === b.fontFamily &&
    a.fontSizePt === b.fontSizePt &&
    Boolean(a.bold) === Boolean(b.bold) &&
    Boolean(a.italic) === Boolean(b.italic) &&
    Boolean(a.underline) === Boolean(b.underline) &&
    Boolean(a.strike) === Boolean(b.strike) &&
    a.color === b.color &&
    a.backgroundColor === b.backgroundColor
  );
}

function sameOptional<T>(a: T | undefined, b: T | undefined, eq: (x: T, y: T) => boolean): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return eq(a, b);
}

function sameFootnoteRef(a?: FootnoteReference, b?: FootnoteReference): boolean {
  return sameOptional(a, b, (x, y) => x.id === y.id && x.kind === y.kind);
}

function sameRevisionInfo(a?: RevisionInfo, b?: RevisionInfo): boolean {
  return sameOptional(a, b, (x, y) => x.type === y.type && x.id === y.id && x.author === y.author && x.date === y.date);
}

/**
 * Returns the full plain text of a paragraph by concatenating all runs.
 */
export function getParagraphText(paragraph: ParagraphNode): string {
  return paragraph.children.map((r) => r.text).join('');
}

/**
 * Merges adjacent runs that have identical formatting.
 */
export function coalesceRuns(runs: RunNode[]): RunNode[] {
  const result: RunNode[] = [];

  for (const run of runs) {
    if (!run.text && !run.drawing && !run.image) continue;

    if (run.drawing || run.image) {
      result.push({
        type: 'run',
        text: run.text ?? '',
        style: run.style ? { ...run.style } : undefined,
        drawing: run.drawing,
        image: run.image,
        footnoteRef: run.footnoteRef ? { ...run.footnoteRef } : undefined,
        commentId: run.commentId,
        breakType: run.breakType,
        revision: run.revision,
        isTab: run.isTab,
      });
      continue;
    }

    const last = result[result.length - 1];
    const sameHyperlink = last?.hyperlink?.url === run.hyperlink?.url && last?.hyperlink?.anchor === run.hyperlink?.anchor;
    const sameBookmark = last?.bookmarkName === run.bookmarkName;
    const sameField = last?.field === run.field;
    // Runs carrying structural metadata must not be merged across different
    // values, and every rebuilt run must keep that metadata — otherwise a
    // styled-range edit silently strips it (v2 N5).
    const sameFootnote = sameFootnoteRef(last?.footnoteRef, run.footnoteRef);
    const sameComment = last?.commentId === run.commentId;
    const sameBreak = last?.breakType === run.breakType;
    const sameRevision = sameRevisionInfo(last?.revision, run.revision);
    const sameTab = Boolean(last?.isTab) === Boolean(run.isTab);

    if (
      last &&
      !last.drawing &&
      !last.image &&
      areTextStylesEqual(last.style, run.style) &&
      sameHyperlink &&
      sameBookmark &&
      sameField &&
      sameFootnote &&
      sameComment &&
      sameBreak &&
      sameRevision &&
      sameTab
    ) {
      last.text += run.text;
    } else {
      result.push({
        type: 'run',
        text: run.text,
        style: run.style ? { ...run.style } : undefined,
        hyperlink: run.hyperlink ? { ...run.hyperlink } : undefined,
        bookmarkName: run.bookmarkName,
        footnoteRef: run.footnoteRef ? { ...run.footnoteRef } : undefined,
        commentId: run.commentId,
        breakType: run.breakType,
        revision: run.revision,
        isTab: run.isTab,
        field: run.field,
      });
    }
  }

  return result;
}

/**
 * Slices a paragraph at [startOffset, endOffset] and applies a style patch to that range.
 * Runs outside the range retain their original formatting.
 *
 * Example:
 * Paragraph: "Halo dunia yang indah" (1 run)
 * Slicing at [5, 10] with { bold: true }:
 * -> Run 1: "Halo " (normal)
 * -> Run 2: "dunia" (bold)
 * -> Run 3: " yang indah" (normal)
 */
export function sliceParagraphRange(
  paragraph: ParagraphNode,
  startOffset: number,
  endOffset: number,
  patchStyle: TextStyle,
): ParagraphNode {
  const fullText = getParagraphText(paragraph);
  const totalLength = fullText.length;

  // Clamp offsets
  const start = Math.max(0, Math.min(startOffset, totalLength));
  const end = Math.max(0, Math.min(endOffset, totalLength));

  if (start >= end) {
    // No-op: range is empty
    return {
      ...paragraph,
      children: paragraph.children.map((r) => ({ ...r, style: r.style ? { ...r.style } : undefined })),
    };
  }

  const newRuns: RunNode[] = [];
  let currentOffset = 0;

  for (const run of paragraph.children) {
    const runText = run.text;
    const runLength = runText.length;
    const runStart = currentOffset;
    const runEnd = runStart + runLength;

    if (runEnd <= start || runStart >= end) {
      // Case 1: Run is completely outside the target range
      newRuns.push({
        type: 'run',
        text: runText,
        style: run.style ? { ...run.style } : undefined,
        drawing: run.drawing,
        image: run.image,
        hyperlink: run.hyperlink ? { ...run.hyperlink } : undefined,
        bookmarkName: run.bookmarkName,
        footnoteRef: run.footnoteRef,
        commentId: run.commentId,
        breakType: run.breakType,
        revision: run.revision,
        isTab: run.isTab,
        field: run.field,
      });
    } else if (runStart >= start && runEnd <= end) {
      // Case 2: Run is completely inside the target range
      newRuns.push({
        type: 'run',
        text: runText,
        style: { ...run.style, ...patchStyle },
        drawing: run.drawing,
        image: run.image,
        hyperlink: run.hyperlink ? { ...run.hyperlink } : undefined,
        bookmarkName: run.bookmarkName,
        footnoteRef: run.footnoteRef,
        commentId: run.commentId,
        breakType: run.breakType,
        revision: run.revision,
        isTab: run.isTab,
        field: run.field,
      });
    } else {
      // Case 3: Partial overlap -> split into up to 3 segments
      const overlapStart = Math.max(runStart, start);
      const overlapEnd = Math.min(runEnd, end);

      const leftText = runText.slice(0, overlapStart - runStart);
      const middleText = runText.slice(overlapStart - runStart, overlapEnd - runStart);
      const rightText = runText.slice(overlapEnd - runStart);

      if (leftText.length > 0) {
        newRuns.push({
          type: 'run',
          text: leftText,
          style: run.style ? { ...run.style } : undefined,
          hyperlink: run.hyperlink ? { ...run.hyperlink } : undefined,
          bookmarkName: run.bookmarkName,
          footnoteRef: run.footnoteRef,
          commentId: run.commentId,
          breakType: run.breakType,
          revision: run.revision,
          isTab: run.isTab,
          field: run.field,
        });
      }

      if (middleText.length > 0) {
        newRuns.push({
          type: 'run',
          text: middleText,
          style: { ...run.style, ...patchStyle },
          hyperlink: run.hyperlink ? { ...run.hyperlink } : undefined,
          bookmarkName: run.bookmarkName,
          footnoteRef: run.footnoteRef,
          commentId: run.commentId,
          breakType: run.breakType,
          revision: run.revision,
          isTab: run.isTab,
          field: run.field,
        });
      }

      if (rightText.length > 0) {
        newRuns.push({
          type: 'run',
          text: rightText,
          style: run.style ? { ...run.style } : undefined,
          hyperlink: run.hyperlink ? { ...run.hyperlink } : undefined,
          bookmarkName: run.bookmarkName,
          footnoteRef: run.footnoteRef,
          commentId: run.commentId,
          breakType: run.breakType,
          revision: run.revision,
          isTab: run.isTab,
          field: run.field,
        });
      }
    }

    currentOffset = runEnd;
  }

  return {
    ...paragraph,
    children: coalesceRuns(newRuns),
  };
}
