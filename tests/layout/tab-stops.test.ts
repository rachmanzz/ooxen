import { describe, expect, it } from 'bun:test';
import { StandardLineBreaker } from '../../src/layout/line-breaker.js';
import type { ParagraphNode } from '../../src/types/ast.js';

describe('Tab Stops Layout & Line Breaker', () => {
  const lineBreaker = new StandardLineBreaker();

  it('calculates default tab stop advance at 36 pt increments', () => {
    const paragraph: ParagraphNode = {
      type: 'paragraph',
      children: [
        {
          type: 'run',
          text: 'A\tB',
        },
      ],
    };

    const lines = lineBreaker.breakParagraph(paragraph, 500);
    expect(lines.length).toBe(1);
    const line = lines[0]!;

    const tabFrag = line.fragments.find((f) => f.isTab);
    expect(tabFrag).toBeDefined();
    expect(tabFrag?.isTab).toBe(true);
    // 'A' has width around 6-8pt, so next default tab stop is 36pt
    // 'B' starts at 36pt
    const fragB = line.fragments[line.fragments.length - 1]!;
    expect(fragB.text).toBe('B');
    expect(fragB.bounds.x).toBeCloseTo(36, 1);
  });

  it('advances to custom left tab stop position', () => {
    const paragraph: ParagraphNode = {
      type: 'paragraph',
      style: {
        tabStops: [
          { positionPt: 100, alignment: 'left' },
        ],
      },
      children: [
        {
          type: 'run',
          text: 'Item\tDescription',
        },
      ],
    };

    const lines = lineBreaker.breakParagraph(paragraph, 500);
    const line = lines[0]!;

    const descFrag = line.fragments.find((f) => f.text === 'Description');
    expect(descFrag).toBeDefined();
    // 'Description' starts right at 100pt
    expect(descFrag?.bounds.x).toBeCloseTo(100, 1);
  });

  it('keeps a paragraph-initial tab when tab stops are defined', () => {
    // Journal title pattern: jc=left with a center tab stop at the
    // content midpoint. Dropping the leading tab left-aligns the title.
    const paragraph: ParagraphNode = {
      type: 'paragraph',
      style: {
        alignment: 'left',
        tabStops: [
          { positionPt: 226.75, alignment: 'center' },
          { positionPt: 367.55, alignment: 'left' },
        ],
      },
      children: [
        {
          type: 'run',
          text: '\tJudul Artikel',
        },
      ],
    };

    const lines = lineBreaker.breakParagraph(paragraph, 453.5);
    const line = lines[0]!;

    const tabFrag = line.fragments.find((f) => f.isTab);
    expect(tabFrag).toBeDefined();
    const titleFrag = line.fragments.find((f) => !f.isTab && f.text.trim().length > 0);
    expect(titleFrag).toBeDefined();
    // Title starts right of the margin: the tab advance is preserved.
    expect(titleFrag!.bounds.x).toBeGreaterThan(8);
  });

  it('aligns following text to right tab stop with dot leader', () => {
    const paragraph: ParagraphNode = {
      type: 'paragraph',
      style: {
        tabStops: [
          { positionPt: 300, alignment: 'right', leader: 'dot' },
        ],
      },
      children: [
        {
          type: 'run',
          text: 'Chapter 1\t42',
        },
      ],
    };

    const lines = lineBreaker.breakParagraph(paragraph, 500);
    const line = lines[0]!;

    const tabFrag = line.fragments.find((f) => f.isTab);
    expect(tabFrag).toBeDefined();
    expect(tabFrag?.isTab).toBe(true);
    expect(tabFrag?.tabLeader).toBe('dot');

    const pageNumFrag = line.fragments[line.fragments.length - 1]!;
    expect(pageNumFrag.text).toBe('42');
    // The right edge of '42' should align at 300pt
    const rightEdge = pageNumFrag.bounds.x + pageNumFrag.bounds.width;
    expect(rightEdge).toBeCloseTo(300, 1);
  });
});
