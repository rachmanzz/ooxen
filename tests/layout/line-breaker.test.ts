import { describe, expect, it } from 'bun:test';
import { StandardLineBreaker } from '../../src/layout/line-breaker.js';
import { FontMetricsRegistry } from '../../src/fonts/font-metrics-registry.js';
import { SimpleTextMetricsMeasurer } from '../../src/layout/text-metrics.js';
import type { ParagraphNode } from '../../src/types/ast.js';
import type { TabStopAlignment } from '../../src/types/style.js';

describe('Layout Line Breaker', () => {
  const lineBreaker = new StandardLineBreaker();

  it('should break text into multiple lines when it exceeds available width', () => {
    const paragraph: ParagraphNode = {
      type: 'paragraph',
      children: [
        {
          type: 'run',
          text: 'This is a long sentence designed to test word wrapping functionality in Ooxen layout engine.',
        },
      ],
    };

    // Width of 150pt should force multiple lines
    const lines = lineBreaker.breakParagraph(paragraph, 150);
    expect(lines.length).toBeGreaterThan(1);

    for (const line of lines) {
      expect(line.bounds.width).toBeLessThanOrEqual(160); // within tolerance
      expect(line.fragments.length).toBeGreaterThan(0);
    }
  });

  it('should respect explicit line breaks', () => {
    const paragraph: ParagraphNode = {
      type: 'paragraph',
      children: [
        {
          type: 'run',
          text: 'Line 1\nLine 2\nLine 3',
        },
      ],
    };

    const lines = lineBreaker.breakParagraph(paragraph, 500);
    expect(lines.length).toBe(3);
    expect(lines[0]?.fragments[0]?.text).toBe('Line');
    expect(lines[1]?.fragments[0]?.text).toBe('Line');
    expect(lines[2]?.fragments[0]?.text).toBe('Line');
  });

  it('keeps a paragraph-initial tab and advances to the first default stop (F-TABLEAD)', () => {
    // A typed Tab at the start of a paragraph is a real tab in Word: the
    // text lands on the next 36pt stop, it is not collapsed like a space.
    const paragraph: ParagraphNode = {
      type: 'paragraph',
      children: [{ type: 'run', text: '\tHello world' }],
    };

    const lines = lineBreaker.breakParagraph(paragraph, 500);
    expect(lines.length).toBe(1);
    expect(lines[0]?.fragments[0]?.isTab).toBe(true);
    const text = lines[0]!.fragments.find((f) => f.text.includes('Hello'))!;
    expect(lines[0]!.bounds.x + text.bounds.x).toBeCloseTo(36, 5);
  });

  it('advances two leading tabs to the second default stop (F-TABLEAD)', () => {
    const paragraph: ParagraphNode = {
      type: 'paragraph',
      children: [{ type: 'run', text: '\t\tHello' }],
    };
    const lines = lineBreaker.breakParagraph(paragraph, 500);
    const text = lines[0]!.fragments.find((f) => f.text.includes('Hello'))!;
    expect(lines[0]!.bounds.x + text.bounds.x).toBeCloseTo(72, 5);
  });

  it('should keep tabs in the middle of a line', () => {
    const paragraph: ParagraphNode = {
      type: 'paragraph',
      children: [{ type: 'run', text: 'Hello\tworld' }],
    };

    const lines = lineBreaker.breakParagraph(paragraph, 500);
    expect(lines.length).toBe(1);
    expect(lines[0]?.fragments.some((f) => f.isTab)).toBe(true);
  });

  it('should keep a tab that starts a wrapped continuation line', () => {
    // Narrow width pushes the tab off line 1: only paragraph-initial tabs
    // collapse, wrapped-line tabs survive (pendirian-pt leader rows).
    const paragraph: ParagraphNode = {
      type: 'paragraph',
      children: [{ type: 'run', text: 'aaaaa\tb' }],
    };

    const lines = lineBreaker.breakParagraph(paragraph, 30);
    expect(lines.length).toBe(3);
    expect(lines[1]?.fragments.some((f) => f.isTab)).toBe(true);
  });

  it('should apply center and right alignment offsets', () => {
    const paragraphCenter: ParagraphNode = {
      type: 'paragraph',
      style: { alignment: 'center' },
      children: [{ type: 'run', text: 'Centered' }],
    };

    const linesCenter = lineBreaker.breakParagraph(paragraphCenter, 300);
    expect(linesCenter.length).toBe(1);
    expect(linesCenter[0]?.fragments[0]?.bounds.x).toBeGreaterThan(0);

    const paragraphRight: ParagraphNode = {
      type: 'paragraph',
      style: { alignment: 'right' },
      children: [{ type: 'run', text: 'Right' }],
    };

    const linesRight = lineBreaker.breakParagraph(paragraphRight, 300);
    expect(linesRight.length).toBe(1);
    expect(linesRight[0]?.fragments[0]?.bounds.x).toBeGreaterThan(linesCenter[0]?.fragments[0]?.bounds.x ?? 0);
  });
});

describe('Decimal and bar tab stops (F-TABSPAN)', () => {
  const lineBreaker = new StandardLineBreaker();
  const measurer = new SimpleTextMetricsMeasurer(new FontMetricsRegistry());

  const tabbedParagraph = (alignment: TabStopAlignment, text = '123.45'): ParagraphNode => ({
    type: 'paragraph',
    style: { tabStops: [{ positionPt: 200, alignment }] },
    children: [
      { type: 'run', text: 'val:' },
      { type: 'run', text: '', isTab: true },
      { type: 'run', text },
    ],
  });

  const tabFragmentOf = (alignment: TabStopAlignment, text?: string) => {
    const lines = lineBreaker.breakParagraph(tabbedParagraph(alignment, text), 500);
    expect(lines.length).toBe(1);
    const tab = lines[0]!.fragments.find((f) => f.isTab);
    expect(tab).toBeDefined();
    return tab!;
  };

  it('anchors the decimal point at the stop', () => {
    const tab = tabFragmentOf('decimal');
    const integerWidth = measurer.measureText('123', { fontSizePt: 11 }).width;
    expect(tab.bounds.x + tab.bounds.width + integerWidth).toBeCloseTo(200, 0);
    // A left stop advances from the tab position instead of the point.
    const left = tabFragmentOf('left');
    expect(left.bounds.x + left.bounds.width).toBeCloseTo(200, 0);
  });

  it('right-aligns decimal text without a point', () => {
    const tab = tabFragmentOf('decimal', '12345');
    const textWidth = measurer.measureText('12345', { fontSizePt: 11 }).width;
    expect(tab.bounds.x + tab.bounds.width + textWidth).toBeCloseTo(200, 0);
  });

  it('marks bar tabs and advances to the stop', () => {
    const tab = tabFragmentOf('bar', 'after');
    expect(tab.bounds.x + tab.bounds.width).toBeCloseTo(200, 0);
    expect(tab.barTab).toBe(true);
    expect(tabFragmentOf('left', 'after').barTab).not.toBe(true);
  });

  it('measures the numbering prefix in the paragraph font so a symbol font cannot inflate the line (F-NUMBOX)', () => {
    // A symbol face reports a giant fontBoundingBox (tallest glyphs, not
    // the bullet). The line box must follow the paragraph font instead.
    const familyMetrics = {
      measureText: (text: string, style?: { fontSizePt?: number; fontFamily?: string }) => {
        const size = style?.fontSizePt ?? 11;
        const big = style?.fontFamily === 'Noto Sans Symbols';
        const ascent = big ? size * 1.6 : size * 0.82;
        const descent = big ? size * 0.5 : size * 0.22;
        return { width: text.length * size * 0.5, height: ascent + descent, ascent, descent };
      },
    };
    const breaker = new StandardLineBreaker(familyMetrics as unknown as import('../../src/layout/text-metrics.js').TextMetricsMeasurer);
    const paragraph: ParagraphNode = {
      type: 'paragraph',
      style: {
        numbering: {
          numId: 2,
          level: 0,
          format: 'bullet',
          prefixText: '▪',
          prefixFontFamily: 'Noto Sans Symbols',
        },
      },
      children: [{ type: 'run', text: 'Body', style: { fontFamily: 'Cambria', fontSizePt: 9 } }],
    };
    const lines = breaker.breakParagraph(paragraph, 400);
    // 9pt text line ≈ 9.36; the symbol box alone would give ≈ 18.9.
    expect(lines[0]!.bounds.height).toBeCloseTo(9.36, 0);
    // The bullet still renders in the level font.
    expect(lines[0]!.fragments[0]!.style?.fontFamily).toBe('Noto Sans Symbols');
  });

  it('sends the numbering tab to the text indent, not to an explicit stop (F-NUMTAB)', () => {
    const paragraph: ParagraphNode = {
      type: 'paragraph',
      style: {
        indentLeftPt: 36,
        firstLineIndentPt: -18,
        tabStops: [{ positionPt: 200, alignment: 'center', leader: 'none' }],
        numbering: {
          numId: 2,
          level: 0,
          format: 'bullet',
          prefixText: '▪',
        },
      },
      children: [{ type: 'run', text: 'Body text' }],
    };
    const lines = lineBreaker.breakParagraph(paragraph, 400);
    const line = lines[0]!;
    const body = line.fragments.find((f) => f.text.includes('Body'))!;
    // Text starts at the hanging indent end (36pt from margin),
    // not centered on the explicit 200pt stop.
    expect(line.bounds.x + body.bounds.x).toBeCloseTo(36, 0);
  });

  it('renders the numbering prefix in the level font, not the paragraph font (F-NUMFONT)', () => {
    const paragraph: ParagraphNode = {
      type: 'paragraph',
      style: {
        numbering: {
          numId: 2,
          level: 0,
          format: 'bullet',
          prefixText: '▪',
          prefixFontFamily: 'Noto Sans Symbols',
        },
      },
      children: [
        { type: 'run', text: 'Header text', style: { fontFamily: 'Cambria', fontSizePt: 9 } },
      ],
    };
    const lines = lineBreaker.breakParagraph(paragraph, 400);
    const first = lines[0]!.fragments[0]!;
    expect(first.text).toContain('▪');
    expect(first.style?.fontFamily).toBe('Noto Sans Symbols');
    // Body text keeps the paragraph font.
    expect(lines[0]!.fragments.some((f) => f.text.includes('Header') && f.style?.fontFamily === 'Cambria')).toBe(true);
  });

  it('sizes an empty paragraph from the paragraph-mark font, not the default (F-PMARK)', () => {
    const paragraph: ParagraphNode = {
      type: 'paragraph',
      style: { markFontSizePt: 16 },
      children: [],
    };
    const lines = lineBreaker.breakParagraph(paragraph, 400);
    expect(lines.length).toBe(1);
    // 16pt pilcrow: 16 * 1.2, the same factor as the 11pt default (13.2).
    expect(lines[0]!.bounds.height).toBeCloseTo(19.2, 5);
  });

  it('sizes an anchor-only paragraph from the paragraph-mark font (F-PMARK)', () => {
    const paragraph: ParagraphNode = {
      type: 'paragraph',
      style: { markFontSizePt: 16 },
      children: [
        { type: 'run', text: '' },
        {
          type: 'run',
          text: '',
          drawing: {
            type: 'drawing',
            name: 'Rule',
            widthPt: 450,
            heightPt: 1,
            commands: [],
            anchor: { horizontalFrom: 'column', horizontalOffsetPt: 7, verticalFrom: 'paragraph', verticalOffsetPt: 23 },
          },
        },
      ],
    };
    const lines = lineBreaker.breakParagraph(paragraph, 400);
    expect(lines.length).toBe(1);
    expect(lines[0]!.bounds.height).toBeGreaterThan(15);
  });

  it('finds the numbering tab after a multi-word prefix (F-NUMTAB)', () => {
    const paragraph: ParagraphNode = {
      type: 'paragraph',
      style: {
        indentLeftPt: 72,
        firstLineIndentPt: -54,
        tabStops: [{ positionPt: 200, alignment: 'center', leader: 'none' }],
        numbering: {
          numId: 3,
          level: 0,
          format: 'decimal',
          prefixText: 'Article 1',
        },
      },
      children: [{ type: 'run', text: 'Body text' }],
    };
    const lines = lineBreaker.breakParagraph(paragraph, 400);
    const line = lines[0]!;
    const body = line.fragments.find((f) => f.text.includes('Body'))!;
    // The tab after "Article 1" still advances to the text indent (72pt),
    // not to the explicit 200pt stop.
    expect(line.bounds.x + body.bounds.x).toBeCloseTo(72, 0);
  });

  it('advances a number wider than its hanging indent to the next tab stop (F-NUMTAB)', () => {
    const paragraph: ParagraphNode = {
      type: 'paragraph',
      style: {
        indentLeftPt: 18,
        firstLineIndentPt: -18,
        numbering: { numId: 4, level: 0, format: 'upperRoman', prefixText: 'XXVIII.' },
      },
      children: [{ type: 'run', text: 'Body text', style: { fontSizePt: 12 } }],
    };
    const lines = lineBreaker.breakParagraph(paragraph, 400);
    const line = lines[0]!;
    const prefix = line.fragments[0]!;
    const body = line.fragments.find((f) => f.text.includes('Body'))!;
    const numberEnd = line.bounds.x + prefix.bounds.x + prefix.bounds.width;
    expect(numberEnd).toBeGreaterThan(18);
    const bodyX = line.bounds.x + body.bounds.x;
    // Past the indent end, the tab lands on the next default 36pt stop
    // rather than a fixed 8pt gap after the number.
    expect(bodyX).toBeGreaterThanOrEqual(numberEnd + 2);
    expect(bodyX % 36).toBeCloseTo(0, 5);
  });

  it('keeps the numbering prefix width from the level font while clamping its box (F-NUMBOX)', async () => {
    const { StandardLineBreaker } = await import('../../src/layout/line-breaker.js');
    // Fake metrics: the 'Wide' face is five times wider than anything else.
    const metrics = {
      measureText: (text: string, style?: { fontFamily?: string; fontSizePt?: number }) => {
        const size = style?.fontSizePt ?? 11;
        const perChar = style?.fontFamily === 'Wide' ? size * 2.5 : size * 0.5;
        return { width: text.length * perChar, height: size * 1.2, ascent: size, descent: size * 0.2 };
      },
    };
    const breaker = new StandardLineBreaker(metrics);
    const paragraph: ParagraphNode = {
      type: 'paragraph',
      style: {
        indentLeftPt: 18,
        firstLineIndentPt: -18,
        numbering: { numId: 5, level: 0, format: 'decimal', prefixText: '12.', prefixFontFamily: 'Wide' },
      },
      children: [{ type: 'run', text: 'Body', style: { fontSizePt: 10 } }],
    };
    const line = breaker.breakParagraph(paragraph, 400)[0]!;
    const prefix = line.fragments[0]!;
    // 3 chars at 25pt each in the level font, not 5pt each in the paragraph font.
    expect(prefix.bounds.width).toBeCloseTo(75, 5);
    const body = line.fragments.find((f) => f.text.includes('Body'))!;
    expect(line.bounds.x + body.bounds.x).toBeGreaterThanOrEqual(line.bounds.x + prefix.bounds.x + 75);
  });
});
