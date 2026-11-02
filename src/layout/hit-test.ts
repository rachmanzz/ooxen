import type { HyperlinkInfo } from '../types/ast.js';
import type { PageLayout } from './page-engine.js';

/**
 * Plain object representing the result of a coordinate hit-test.
 */
export interface HitTestResult {
  lineIndex: number;
  fragmentIndex: number;
  charOffsetInFragment: number;
  charOffsetInLine: number;
  text: string;
  charAt?: string;
  hyperlink?: HyperlinkInfo;
  bookmarkName?: string;
  commentId?: string;
}

/**
 * Pure function: calculates the text position/character offset from canvas coordinates (x, y).
 * Works directly on a PageLayout object.
 */
export function hitTestPage(page: PageLayout, x: number, y: number): HitTestResult | undefined {
  if (!page.lines || page.lines.length === 0) {
    return undefined;
  }

  // 1. Find the target line
  let targetLineIndex = -1;
  let minVertDist = Infinity;

  for (let i = 0; i < page.lines.length; i++) {
    const line = page.lines[i]!;
    const lineTop = line.bounds.y;
    const lineBottom = line.bounds.y + line.bounds.height;

    if (y >= lineTop && y <= lineBottom) {
      targetLineIndex = i;
      break;
    }

    // Distance to line box
    const dist = y < lineTop ? lineTop - y : y - lineBottom;
    if (dist < minVertDist) {
      minVertDist = dist;
      targetLineIndex = i;
    }
  }

  if (targetLineIndex === -1) return undefined;

  const line = page.lines[targetLineIndex]!;
  if (!line.fragments || line.fragments.length === 0) {
    return {
      lineIndex: targetLineIndex,
      fragmentIndex: 0,
      charOffsetInFragment: 0,
      charOffsetInLine: 0,
      text: '',
    };
  }

  // 2. Find the fragment within the line
  let targetFragIndex = 0;
  let minHorizDist = Infinity;

  for (let f = 0; f < line.fragments.length; f++) {
    const fragment = line.fragments[f]!;
    const fragX = line.bounds.x + fragment.bounds.x;
    const fragRight = fragX + fragment.bounds.width;

    if (x >= fragX && x <= fragRight) {
      targetFragIndex = f;
      break;
    }

    const dist = x < fragX ? fragX - x : x - fragRight;
    if (dist < minHorizDist) {
      minHorizDist = dist;
      targetFragIndex = f;
    }
  }

  const fragment = line.fragments[targetFragIndex]!;
  const fragX = line.bounds.x + fragment.bounds.x;
  const fragWidth = Math.max(1, fragment.bounds.width);

  // 3. Calculate character offset inside the fragment
  const relX = Math.max(0, Math.min(fragWidth, x - fragX));
  const textLength = fragment.text.length;
  let charOffsetInFragment = 0;

  if (textLength > 0) {
    const ratio = relX / fragWidth;
    charOffsetInFragment = Math.min(textLength, Math.round(ratio * textLength));
  }

  // 4. Calculate total char offset in line
  let charOffsetInLine = 0;
  for (let f = 0; f < targetFragIndex; f++) {
    charOffsetInLine += line.fragments[f]!.text.length;
  }
  charOffsetInLine += charOffsetInFragment;

  const charAt =
    charOffsetInFragment < textLength ? fragment.text[charOffsetInFragment] : undefined;

  return {
    lineIndex: targetLineIndex,
    fragmentIndex: targetFragIndex,
    charOffsetInFragment,
    charOffsetInLine,
    text: fragment.text,
    charAt,
    hyperlink: fragment.hyperlink,
    bookmarkName: fragment.bookmarkName,
    commentId: fragment.commentId,
  };
}
