import { describe, expect, it } from 'bun:test';
import { StandardPageEngine } from '../../src/layout/page-engine.js';
import type { DocumentNode, ParagraphNode } from '../../src/types/ast.js';

describe('Layout Page Engine', () => {
  const pageEngine = new StandardPageEngine();

  it('should paginate content into multiple pages when exceeding page height', () => {
    // Generate 60 paragraphs to ensure multiple pages are created on Letter paper (792pt height, ~648pt content)
    const paragraphs: ParagraphNode[] = [];
    for (let i = 1; i <= 60; i++) {
      paragraphs.push({
        type: 'paragraph',
        style: { spaceAfterPt: 6 },
        children: [{ type: 'run', text: `Paragraph #${i}: Layout test content for pagination.` }],
      });
    }

    const doc: DocumentNode = {
      type: 'document',
      sections: [
        {
          type: 'section',
          properties: {
            pageSize: { width: 612, height: 792 },
            margins: { top: 72, right: 72, bottom: 72, left: 72 },
          },
          children: paragraphs,
        },
      ],
    };

    const pages = pageEngine.layoutDocument(doc);
    expect(pages.length).toBeGreaterThan(1);

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i]!;
      expect(page.pageIndex).toBe(i);
      expect(page.size.width).toBe(612);
      expect(page.size.height).toBe(792);
      expect(page.lines.length).toBeGreaterThan(0);

      // Verify all lines stay within vertical margin bounds
      for (const line of page.lines) {
        expect(line.bounds.y).toBeGreaterThanOrEqual(72);
        expect(line.bounds.y).toBeLessThanOrEqual(792 - 72 + 20);
      }
    }
  });

  it('should honor lineSpacingPt as the minimum vertical advance per line', () => {
    // Same body, once with natural advance and once with exact-like 24pt
    // spacing: content height is 648pt, so 24pt spacing caps each page at
    // 27 lines and must paginate MORE pages than natural advance.
    const makeDoc = (lineSpacingPt?: number): DocumentNode => ({
      type: 'document',
      sections: [
        {
          type: 'section',
          properties: {
            pageSize: { width: 612, height: 792 },
            margins: { top: 72, right: 72, bottom: 72, left: 72 },
          },
          children: Array.from({ length: 60 }, (_, i) => ({
            type: 'paragraph' as const,
            style: { spaceAfterPt: 0, lineSpacingPt },
            children: [{ type: 'run' as const, text: `Paragraph #${i + 1}: Layout test content for pagination.` }],
          })),
        },
      ],
    });

    const natural = pageEngine.layoutDocument(makeDoc(undefined));
    const spaced = pageEngine.layoutDocument(makeDoc(24));
    expect(spaced.length).toBeGreaterThan(natural.length);
    for (const page of spaced) {
      expect(page.lines.length).toBeLessThanOrEqual(27); // 648 / 24
    }
  });
});
