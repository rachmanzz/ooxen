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
});
