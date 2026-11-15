import { describe, expect, it } from 'bun:test';
import { StandardPageEngine } from '../../src/layout/page-engine.js';
import type { BlockNode, DocumentNode, ParagraphNode } from '../../src/types/ast.js';
import type { ParagraphStyle } from '../../src/types/style.js';

const engine = new StandardPageEngine();
const doc = (children: BlockNode[], extra?: Partial<DocumentNode['sections'][number]>): DocumentNode => ({
  type: 'document',
  sections: [
    {
      type: 'section',
      properties: { pageSize: { width: 612, height: 792 }, margins: { top: 72, right: 72, bottom: 72, left: 72 } },
      children,
      ...extra,
    },
  ],
});
const longText = Array.from({ length: 40 }, () => 'word').join(' ');
const para = (style: ParagraphStyle | undefined, text = longText, styleId?: string): ParagraphNode => ({
  type: 'paragraph',
  styleId,
  style,
  children: [{ type: 'run', text, style: { fontSizePt: 16 } }],
});
const lineYs = (d: DocumentNode): number[] => engine.layoutDocument(d)[0]!.lines.map((l) => l.bounds.y);

describe('Paragraph line-spacing rules and contextual spacing (w:spacing, w:contextualSpacing)', () => {
  it('scales the natural line height for lineRule="auto", whatever the font size', () => {
    const single = lineYs(doc([para({ lineSpacingRule: 'auto', lineSpacingMultiple: 1 })]));
    const onePointFive = lineYs(doc([para({ lineSpacingRule: 'auto', lineSpacingMultiple: 1.5, lineSpacingPt: 19.8 })]));
    expect(single.length).toBeGreaterThan(2);
    const pitch = single[1]! - single[0]!;
    // 16pt text: a single line is above the 11pt-based 13.2pt approximation
    // the old fixed value would have forced.
    expect(pitch).toBeGreaterThan(13.2);
    expect(onePointFive[1]! - onePointFive[0]!).toBeCloseTo(pitch * 1.5, 3);
  });

  it('honours exact, atLeast, and atMost against the natural height', () => {
    const natural = lineYs(doc([para(undefined)]));
    const pitch = natural[1]! - natural[0]!;
    const exact = lineYs(doc([para({ lineSpacingRule: 'exact', lineSpacingPt: 10 })]));
    expect(exact[1]! - exact[0]!).toBeCloseTo(10, 5);
    const atLeastSmall = lineYs(doc([para({ lineSpacingRule: 'atLeast', lineSpacingPt: 10 })]));
    expect(atLeastSmall[1]! - atLeastSmall[0]!).toBeCloseTo(pitch, 5);
    const atLeastBig = lineYs(doc([para({ lineSpacingRule: 'atLeast', lineSpacingPt: 30 })]));
    expect(atLeastBig[1]! - atLeastBig[0]!).toBeCloseTo(30, 5);
    const atMost = lineYs(doc([para({ lineSpacingRule: 'atMost', lineSpacingPt: 12 })]));
    expect(atMost[1]! - atMost[0]!).toBeCloseTo(12, 5);
    // A point value with no rule keeps the historical floor semantics.
    const legacy = lineYs(doc([para({ lineSpacingPt: 30 })]));
    expect(legacy[1]! - legacy[0]!).toBeCloseTo(30, 5);
  });

  it('drops the space between same-style neighbours when contextualSpacing is set', () => {
    const item = (styleId: string, contextual = true): ParagraphNode =>
      para({ spaceBeforePt: 6, spaceAfterPt: 8, contextualSpacing: contextual }, 'item', styleId);
    const sameStyle = lineYs(doc([item('ListParagraph'), item('ListParagraph')]));
    const otherStyle = lineYs(doc([item('ListParagraph'), item('Normal')]));
    const noFlag = lineYs(doc([item('ListParagraph', false), item('ListParagraph', false)]));
    const lineH = otherStyle[1]! - otherStyle[0]! - 8 - 6;
    expect(sameStyle[1]! - sameStyle[0]!).toBeCloseTo(lineH, 5);
    expect(noFlag[1]! - noFlag[0]!).toBeCloseTo(lineH + 8 + 6, 5);
  });

  it('applies paragraph spacing and line rules inside table cells', () => {
    const cellPara = (style: ParagraphStyle): ParagraphNode => para(style, 'cell');
    const pages = engine.layoutDocument(
      doc([
        {
          type: 'table',
          columnWidthsPt: [300],
          rows: [
            {
              type: 'table-row',
              children: [{ type: 'table-cell', children: [cellPara({ spaceBeforePt: 10, spaceAfterPt: 4 }), cellPara({ lineSpacingRule: 'exact', lineSpacingPt: 40 })] }],
            },
          ],
        },
        para(undefined, 'after'),
      ]),
    );
    const lines = pages[0]!.lines;
    // Default cell padding is 2pt on top; the first paragraph adds its 10pt before.
    expect(lines[0]!.bounds.y).toBeCloseTo(72 + 2 + 10, 5);
    const firstH = lines[0]!.bounds.height;
    expect(lines[1]!.bounds.y).toBeCloseTo(72 + 2 + 10 + firstH + 4, 5);
    // The exact 40pt line pushes the row height: the paragraph after the
    // table starts below 2 + 10 + firstH + 4 + 40 + 2 (bottom padding).
    const after = lines.find((l) => l.fragments.some((f) => f.text === 'after'))!;
    expect(after.bounds.y).toBeGreaterThanOrEqual(72 + 2 + 10 + firstH + 4 + 40 + 2 - 0.01);
  });

  it('applies paragraph spacing in headers and footers', () => {
    const pages = engine.layoutDocument(
      doc([para(undefined, 'body')], {
        headers: {
          default: {
            type: 'header',
            kind: 'default',
            children: [para({ spaceAfterPt: 6 }, 'one'), para({ spaceBeforePt: 5 }, 'two')],
          },
        },
      }),
    );
    const [one, two] = pages[0]!.headerLines!;
    expect(two!.bounds.y - one!.bounds.y).toBeCloseTo(one!.bounds.height + 6 + 5, 5);
  });
});
