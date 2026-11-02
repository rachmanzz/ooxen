import type {
  DrawingShapeNode,
  FootnoteReference,
  HyperlinkInfo,
  ImageNode,
  ParagraphNode,
  RunNode,
} from '../types/ast.js';
import type { Rect } from '../types/common.js';
import type { TextStyle } from '../types/style.js';
import { defaultTextMetrics, type TextMetricsMeasurer } from './text-metrics.js';

/**
 * Line breaking and word wrapping layout model.
 */

export interface LineFragment {
  text: string;
  style?: TextStyle;
  drawing?: DrawingShapeNode;
  image?: ImageNode;
  bounds: Rect; // relative to line (x: offset from line start, y: 0)
  hyperlink?: HyperlinkInfo;
  bookmarkName?: string;
  footnoteRef?: FootnoteReference;
  commentId?: string;
}

export interface LayoutLine {
  bounds: Rect; // relative to paragraph content box
  fragments: LineFragment[];
  baseline: number;
}

export interface LineBreaker {
  breakParagraph(paragraph: ParagraphNode, availableWidth: number): LayoutLine[];
}

interface WordToken {
  text: string;
  isSpace: boolean;
  width: number;
  height: number;
  ascent: number;
  descent: number;
  style?: TextStyle;
  drawing?: DrawingShapeNode;
  image?: ImageNode;
  hyperlink?: HyperlinkInfo;
  bookmarkName?: string;
  footnoteRef?: FootnoteReference;
  commentId?: string;
}

export class StandardLineBreaker implements LineBreaker {
  private metrics: TextMetricsMeasurer;

  constructor(metrics: TextMetricsMeasurer = defaultTextMetrics) {
    this.metrics = metrics;
  }

  breakParagraph(paragraph: ParagraphNode, availableWidth: number): LayoutLine[] {
    const pStyle = paragraph.style;
    const alignment = pStyle?.alignment ?? 'left';
    const indentLeft = pStyle?.indentLeftPt ?? 0;
    const indentRight = pStyle?.indentRightPt ?? 0;
    const firstLineIndent = pStyle?.firstLineIndentPt ?? 0;

    const baseEffectiveWidth = Math.max(10, availableWidth - indentLeft - indentRight);

    // 1. Tokenize runs into words and whitespace tokens (with numbering prefix if present)
    const prefixText = paragraph.style?.numbering?.prefixText;
    const runsToTokenize: RunNode[] = prefixText
      ? [{ type: 'run', text: `${prefixText}\t`, style: paragraph.children[0]?.style }, ...paragraph.children]
      : paragraph.children;

    const tokens = this.tokenizeRuns(runsToTokenize);
    if (tokens.length === 0) {
      // Empty paragraph line
      const defaultSize = 11;
      const height = defaultSize * 1.2;
      return [
        {
          bounds: { x: indentLeft + firstLineIndent, y: 0, width: 0, height },
          fragments: [],
          baseline: defaultSize * 0.82,
        },
      ];
    }

    // 2. Line breaking loop
    const lines: LayoutLine[] = [];
    let currentTokens: WordToken[] = [];
    let currentLineWidth = 0;
    let isFirstLine = true;
    let currentY = 0;

    const getLineWidth = (first: boolean): number => {
      const extraIndent = first ? firstLineIndent : 0;
      return Math.max(10, baseEffectiveWidth - extraIndent);
    };

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i]!;
      const maxLineWidth = getLineWidth(isFirstLine);

      if (token.text === '\n') {
        // Explicit line break
        const line = this.finalizeLine(
          currentTokens,
          maxLineWidth,
          alignment,
          indentLeft + (isFirstLine ? firstLineIndent : 0),
          currentY,
          false,
        );
        lines.push(line);
        currentY += line.bounds.height;
        currentTokens = [];
        currentLineWidth = 0;
        isFirstLine = false;
        continue;
      }

      // Check if adding this token overflows
      if (currentLineWidth + token.width > maxLineWidth && currentTokens.length > 0) {
        // If the current token is a space at the end of the line, skip it
        if (token.isSpace) {
          continue;
        }

        const line = this.finalizeLine(
          currentTokens,
          maxLineWidth,
          alignment,
          indentLeft + (isFirstLine ? firstLineIndent : 0),
          currentY,
          true,
        );
        lines.push(line);
        currentY += line.bounds.height;
        currentTokens = [];
        currentLineWidth = 0;
        isFirstLine = false;
      }

      // Avoid leading spaces on a new line
      if (currentTokens.length === 0 && token.isSpace) {
        continue;
      }

      currentTokens.push(token);
      currentLineWidth += token.width;
    }

    if (currentTokens.length > 0) {
      const maxLineWidth = getLineWidth(isFirstLine);
      const line = this.finalizeLine(
        currentTokens,
        maxLineWidth,
        alignment,
        indentLeft + (isFirstLine ? firstLineIndent : 0),
        currentY,
        false, // last line is not justified
      );
      lines.push(line);
    }

    return lines;
  }

  private tokenizeRuns(runs: RunNode[]): WordToken[] {
    const tokens: WordToken[] = [];

    for (const run of runs) {
      if (run.drawing) {
        tokens.push({
          text: '',
          isSpace: false,
          width: run.drawing.widthPt,
          height: run.drawing.heightPt,
          ascent: run.drawing.heightPt,
          descent: 0,
          style: run.style,
          drawing: run.drawing,
          hyperlink: run.hyperlink,
          bookmarkName: run.bookmarkName,
          commentId: run.commentId,
        });
      }

      if (run.image) {
        tokens.push({
          text: '',
          isSpace: false,
          width: run.image.widthPt,
          height: run.image.heightPt,
          ascent: run.image.heightPt,
          descent: 0,
          style: run.style,
          image: run.image,
          hyperlink: run.hyperlink,
          bookmarkName: run.bookmarkName,
          commentId: run.commentId,
        });
      }

      const text = run.text;
      if (!text) continue;

      let currentWord = '';
      for (let i = 0; i < text.length; i++) {
        const char = text[i]!;

        if (char === '\n') {
          if (currentWord.length > 0) {
            tokens.push(this.createToken(currentWord, false, run.style, run.hyperlink, run.bookmarkName, run.footnoteRef, run.commentId));
            currentWord = '';
          }
          tokens.push(this.createToken('\n', false, run.style, run.hyperlink, run.bookmarkName, run.footnoteRef, run.commentId));
        } else if (char === ' ' || char === '\t') {
          if (currentWord.length > 0) {
            tokens.push(this.createToken(currentWord, false, run.style, run.hyperlink, run.bookmarkName, run.footnoteRef, run.commentId));
            currentWord = '';
          }
          tokens.push(this.createToken(char, true, run.style, run.hyperlink, run.bookmarkName, run.footnoteRef, run.commentId));
        } else {
          currentWord += char;
        }
      }

      if (currentWord.length > 0) {
        tokens.push(this.createToken(currentWord, false, run.style, run.hyperlink, run.bookmarkName, run.footnoteRef, run.commentId));
      }
    }

    return tokens;
  }

  private createToken(
    text: string,
    isSpace: boolean,
    style?: TextStyle,
    hyperlink?: HyperlinkInfo,
    bookmarkName?: string,
    footnoteRef?: FootnoteReference,
    commentId?: string,
  ): WordToken {
    const m = this.metrics.measureText(text, style);
    return {
      text,
      isSpace,
      width: m.width,
      height: m.height,
      ascent: m.ascent,
      descent: m.descent,
      style,
      hyperlink,
      bookmarkName,
      footnoteRef,
      commentId,
    };
  }

  private finalizeLine(
    tokens: WordToken[],
    availableWidth: number,
    alignment: string,
    lineStartX: number,
    lineY: number,
    isWrapped: boolean,
  ): LayoutLine {
    // Remove trailing spaces for alignment calculation
    while (tokens.length > 0 && tokens[tokens.length - 1]?.isSpace) {
      tokens.pop();
    }

    let naturalWidth = 0;
    let maxAscent = 0;
    let maxDescent = 0;

    for (const token of tokens) {
      naturalWidth += token.width;
      if (token.ascent > maxAscent) maxAscent = token.ascent;
      if (token.descent > maxDescent) maxDescent = token.descent;
    }

    if (maxAscent === 0) maxAscent = 9;
    if (maxDescent === 0) maxDescent = 2.5;

    const lineHeight = maxAscent + maxDescent;
    const slack = Math.max(0, availableWidth - naturalWidth);

    let startOffset = 0;
    let extraSpacePerSpace = 0;

    if (alignment === 'center') {
      startOffset = slack / 2;
    } else if (alignment === 'right') {
      startOffset = slack;
    } else if (alignment === 'justify' && isWrapped) {
      const spaceCount = tokens.filter((t) => t.isSpace).length;
      if (spaceCount > 0) {
        extraSpacePerSpace = slack / spaceCount;
      }
    }

    // Build line fragments
    const fragments: LineFragment[] = [];
    let currentX = startOffset;

    for (const token of tokens) {
      const wordWidth = token.width + (token.isSpace ? extraSpacePerSpace : 0);
      fragments.push({
        text: token.text,
        style: token.style,
        drawing: token.drawing,
        image: token.image,
        hyperlink: token.hyperlink,
        bookmarkName: token.bookmarkName,
        footnoteRef: token.footnoteRef,
        commentId: token.commentId,
        bounds: {
          x: currentX,
          y: maxAscent - token.ascent, // baseline alignment
          width: wordWidth,
          height: token.height,
        },
      });
      currentX += wordWidth;
    }

    return {
      bounds: {
        x: lineStartX,
        y: lineY,
        width: currentX,
        height: lineHeight,
      },
      fragments,
      baseline: maxAscent,
    };
  }
}

export const defaultLineBreaker = new StandardLineBreaker();
