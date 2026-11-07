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

  it('should collapse a leading tab the way it collapses leading spaces', () => {
    // Reference renderers drop a tab at line start; keeping it indents the
    // first line ~one tab stop away from the reference (story fixture).
    const paragraph: ParagraphNode = {
      type: 'paragraph',
      children: [{ type: 'run', text: '\tHello world' }],
    };

    const lines = lineBreaker.breakParagraph(paragraph, 500);
    expect(lines.length).toBe(1);
    expect(lines[0]?.fragments[0]?.isTab).not.toBe(true);
    expect(lines[0]?.fragments[0]?.bounds.x).toBe(0);
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
});
