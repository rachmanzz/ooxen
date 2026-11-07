import type {
  DrawingShapeNode,
  FootnoteReference,
  HyperlinkInfo,
  ImageNode,
  ParagraphNode,
  RevisionInfo,
  RunNode,
} from '../types/ast.js';
import type { Rect } from '../types/common.js';
import type { TabLeader, TabStop, TextStyle } from '../types/style.js';
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
  breakType?: 'page' | 'column';
  revision?: RevisionInfo;
  isTab?: boolean;
  tabLeader?: TabLeader;
  /** True when the tab matched a `bar` stop: render a vertical rule. */
  barTab?: boolean;
}

export interface LayoutLine {
  bounds: Rect; // relative to paragraph content box
  fragments: LineFragment[];
  baseline: number;
  breakType?: 'page' | 'column';
}

export interface LineBreaker {
  breakParagraph(paragraph: ParagraphNode, availableWidth: number): LayoutLine[];
}

interface WordToken {
  text: string;
  isSpace: boolean;
  isTab?: boolean;
  tabLeader?: TabLeader;
  barTab?: boolean;
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
  breakType?: 'page' | 'column';
  revision?: RevisionInfo;
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
    // A paragraph-initial tab is dropped when real text follows (reference
    // renderers collapse it); a tab-only paragraph keeps its first tab so
    // leader-dot rows survive. Tabs after wrapping are always kept.
    const paraHasText = tokens.some(
      (t) => !t.isSpace && !t.isTab && t.breakType === undefined && t.text !== '\n' && t.text.trim().length > 0,
    );
    let paragraphHasContent = false;
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

      if (token.breakType) {
        // Explicit page or column break
        const line = this.finalizeLine(
          currentTokens,
          maxLineWidth,
          alignment,
          indentLeft + (isFirstLine ? firstLineIndent : 0),
          currentY,
          false,
        );
        line.breakType = token.breakType;
        lines.push(line);
        currentY += line.bounds.height;
        currentTokens = [];
        currentLineWidth = 0;
        isFirstLine = false;
        continue;
      }

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

      if (token.isTab) {
        const lineStartX = indentLeft + (isFirstLine ? firstLineIndent : 0);
        const currentXFromMargin = lineStartX + currentLineWidth;
        const computed = this.computeTabToken(i, tokens, currentXFromMargin, pStyle?.tabStops);
        token.width = computed.width;
        token.tabLeader = computed.leader;
        token.barTab = computed.barTab;
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

        if (token.isTab) {
          const newLineStartX = indentLeft + (isFirstLine ? firstLineIndent : 0);
          const computed = this.computeTabToken(i, tokens, newLineStartX, pStyle?.tabStops);
          token.width = computed.width;
          token.tabLeader = computed.leader;
          token.barTab = computed.barTab;
        }
      }

      // Avoid leading spaces on a new line
      if (currentTokens.length === 0 && token.isSpace) {
        continue;
      }

      // Avoid a paragraph-initial tab when real text follows (see above).
      if (
        currentTokens.length === 0 &&
        token.isTab &&
        isFirstLine &&
        !paragraphHasContent &&
        paraHasText
      ) {
        continue;
      }

      currentTokens.push(token);
      paragraphHasContent = true;
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
          revision: run.revision,
        });
      }

      if (run.image) {
        // Floating (anchored) images do not consume inline space; the page
        // engine positions their fragment at the anchor offset instead.
        const floating = run.image.anchor !== undefined;
        tokens.push({
          text: '',
          isSpace: false,
          width: floating ? 0 : run.image.widthPt,
          height: floating ? 0 : run.image.heightPt,
          ascent: floating ? 0 : run.image.heightPt,
          descent: 0,
          style: run.style,
          image: run.image,
          hyperlink: run.hyperlink,
          bookmarkName: run.bookmarkName,
          commentId: run.commentId,
          revision: run.revision,
        });
      }

      if (run.breakType) {
        if (run.text) {
          let currentWord = '';
          for (let i = 0; i < run.text.length; i++) {
            const char = run.text[i]!;
            if (char === '\n') {
              if (currentWord.length > 0) {
                tokens.push(this.createToken(currentWord, false, run.style, run.hyperlink, run.bookmarkName, run.footnoteRef, run.commentId, run.revision));
                currentWord = '';
              }
              tokens.push(this.createToken('\n', false, run.style, run.hyperlink, run.bookmarkName, run.footnoteRef, run.commentId, run.revision));
            } else if (char === '\t') {
              if (currentWord.length > 0) {
                tokens.push(this.createToken(currentWord, false, run.style, run.hyperlink, run.bookmarkName, run.footnoteRef, run.commentId, run.revision));
                currentWord = '';
              }
              const tabToken = this.createToken('\t', false, run.style, run.hyperlink, run.bookmarkName, run.footnoteRef, run.commentId, run.revision);
              tabToken.isTab = true;
              tokens.push(tabToken);
            } else if (char === ' ') {
              if (currentWord.length > 0) {
                tokens.push(this.createToken(currentWord, false, run.style, run.hyperlink, run.bookmarkName, run.footnoteRef, run.commentId, run.revision));
                currentWord = '';
              }
              tokens.push(this.createToken(char, true, run.style, run.hyperlink, run.bookmarkName, run.footnoteRef, run.commentId, run.revision));
            } else {
              currentWord += char;
            }
          }
          if (currentWord.length > 0) {
            tokens.push(this.createToken(currentWord, false, run.style, run.hyperlink, run.bookmarkName, run.footnoteRef, run.commentId, run.revision));
          }
        }
        tokens.push({
          text: '',
          isSpace: false,
          width: 0,
          height: 0,
          ascent: 0,
          descent: 0,
          breakType: run.breakType,
          style: run.style,
          bookmarkName: run.bookmarkName,
          commentId: run.commentId,
          revision: run.revision,
        });
        continue;
      }

      const text = run.text;
      if (!text) {
        if (run.isTab) {
          const tabToken = this.createToken('\t', false, run.style, run.hyperlink, run.bookmarkName, run.footnoteRef, run.commentId, run.revision);
          tabToken.isTab = true;
          tokens.push(tabToken);
        }
        continue;
      }

      let currentWord = '';
      for (let i = 0; i < text.length; i++) {
        const char = text[i]!;

        if (char === '\n') {
          if (currentWord.length > 0) {
            tokens.push(this.createToken(currentWord, false, run.style, run.hyperlink, run.bookmarkName, run.footnoteRef, run.commentId, run.revision));
            currentWord = '';
          }
          tokens.push(this.createToken('\n', false, run.style, run.hyperlink, run.bookmarkName, run.footnoteRef, run.commentId, run.revision));
        } else if (char === '\t') {
          if (currentWord.length > 0) {
            tokens.push(this.createToken(currentWord, false, run.style, run.hyperlink, run.bookmarkName, run.footnoteRef, run.commentId, run.revision));
            currentWord = '';
          }
          const tabToken = this.createToken('\t', false, run.style, run.hyperlink, run.bookmarkName, run.footnoteRef, run.commentId, run.revision);
          tabToken.isTab = true;
          tokens.push(tabToken);
        } else if (char === ' ') {
          if (currentWord.length > 0) {
            tokens.push(this.createToken(currentWord, false, run.style, run.hyperlink, run.bookmarkName, run.footnoteRef, run.commentId, run.revision));
            currentWord = '';
          }
          tokens.push(this.createToken(char, true, run.style, run.hyperlink, run.bookmarkName, run.footnoteRef, run.commentId, run.revision));
        } else {
          currentWord += char;
        }
      }

      if (currentWord.length > 0) {
        tokens.push(this.createToken(currentWord, false, run.style, run.hyperlink, run.bookmarkName, run.footnoteRef, run.commentId, run.revision));
      }
    }

    return tokens;
  }

  private computeTabToken(
    tokenIndex: number,
    tokens: WordToken[],
    currentXFromMargin: number,
    tabStops?: TabStop[],
  ): { width: number; leader?: TabLeader; barTab?: boolean } {
    const defaultInterval = 36; // 720 twips = 36 pt

    // Look for the next custom tab stop ahead of current position
    const matchedStop = (tabStops ?? [])
      .filter((ts) => ts.positionPt > currentXFromMargin + 2 && ts.alignment !== 'clear')
      .sort((a, b) => a.positionPt - b.positionPt)[0];

    if (matchedStop) {
      if (matchedStop.alignment === 'right' || matchedStop.alignment === 'center' || matchedStop.alignment === 'decimal') {
        let followingWidth = 0;
        let integerWidth = 0;
        let foundDot = false;
        for (let j = tokenIndex + 1; j < tokens.length; j++) {
          const nextT = tokens[j]!;
          if (nextT.isTab || nextT.text === '\n' || nextT.breakType) break;
          followingWidth += nextT.width;
          if (!foundDot && matchedStop.alignment === 'decimal') {
            const dot = nextT.text.indexOf('.');
            if (dot < 0) {
              integerWidth += nextT.width;
            } else {
              integerWidth += this.metrics.measureText(nextT.text.slice(0, dot), nextT.style).width;
              foundDot = true;
            }
          }
        }
        // Decimal tabs anchor the decimal point at the stop; text without
        // a point falls back to right alignment (F-TABSPAN).
        const targetX =
          matchedStop.alignment === 'center'
            ? matchedStop.positionPt - followingWidth / 2
            : matchedStop.alignment === 'decimal' && foundDot
              ? matchedStop.positionPt - integerWidth
              : matchedStop.positionPt - followingWidth;
        const width = Math.max(8, targetX - currentXFromMargin);
        return { width, leader: matchedStop.leader };
      }

      if (matchedStop.alignment === 'bar') {
        // Bar tabs advance to the stop and mark the fragment so renderers
        // paint a vertical rule there (F-TABSPAN).
        const width = Math.max(8, matchedStop.positionPt - currentXFromMargin);
        return { width, leader: 'none', barTab: true };
      }

      // 'left', etc.
      const width = Math.max(8, matchedStop.positionPt - currentXFromMargin);
      return { width, leader: matchedStop.leader };
    }

    // Default tab stop
    const nextDefault = Math.floor((currentXFromMargin + 2) / defaultInterval + 1) * defaultInterval;
    const width = Math.max(8, nextDefault - currentXFromMargin);
    return { width, leader: 'none' };
  }

  private createToken(
    text: string,
    isSpace: boolean,
    style?: TextStyle,
    hyperlink?: HyperlinkInfo,
    bookmarkName?: string,
    footnoteRef?: FootnoteReference,
    commentId?: string,
    revision?: RevisionInfo,
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
      revision,
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

    if (tokens.length === 0) {
      const defaultSize = 11;
      return {
        bounds: {
          x: lineStartX,
          y: lineY,
          width: 0,
          height: defaultSize * 1.2,
        },
        fragments: [],
        baseline: defaultSize * 0.82,
      };
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
        breakType: token.breakType,
        revision: token.revision,
        isTab: token.isTab,
        tabLeader: token.tabLeader,
        barTab: token.barTab,
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
