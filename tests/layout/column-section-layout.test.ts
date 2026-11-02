import { describe, expect, it } from 'bun:test';
import { defaultPageEngine } from '../../src/layout/page-engine.js';
import type { DocumentNode, ParagraphNode } from '../../src/types/ast.js';

describe('Multi-Column Section Layout Engine', () => {
  it('should flow content into the next column on the same page before overflowing to a new page', () => {
    // Page: width = 500, height = 300, margins = 50 each.
    // contentWidth = 400, contentHeight = 200.
    // 2 columns, space = 20 pt:
    // colWidth = (400 - 20) / 2 = 190 pt.
    // Col 0 startX = 50.
    // Col 1 startX = 50 + 190 + 20 = 260.
    const paragraphs: ParagraphNode[] = [];
    // Generate paragraphs of height ~15pt. 200pt contentHeight holds ~12 paragraphs per column.
    for (let i = 1; i <= 20; i++) {
      paragraphs.push({
        type: 'paragraph',
        style: { spaceAfterPt: 5 },
        children: [{ type: 'run', text: `Item #${i}: Short paragraph content.` }],
      });
    }

    const doc: DocumentNode = {
      type: 'document',
      sections: [
        {
          type: 'section',
          properties: {
            pageSize: { width: 500, height: 300 },
            margins: { top: 50, right: 50, bottom: 50, left: 50 },
            columns: { count: 2, spacePt: 20 },
          },
          children: paragraphs,
        },
      ],
    };

    const pages = defaultPageEngine.layoutDocument(doc);
    expect(pages.length).toBeGreaterThanOrEqual(1);

    const firstPage = pages[0]!;
    // In the first page, there must be lines in column 0 (around x=50) AND in column 1 (around x=260)
    const col0Lines = firstPage.lines.filter((l) => l.bounds.x < 150);
    const col1Lines = firstPage.lines.filter((l) => l.bounds.x >= 250);

    expect(col0Lines.length).toBeGreaterThan(0);
    expect(col1Lines.length).toBeGreaterThan(0);

    // Verify coordinates
    expect(col0Lines[0]!.bounds.x).toBeCloseTo(50, 1);
    expect(col1Lines[0]!.bounds.x).toBeCloseTo(260, 1);
  });

  it('should create new pages when all columns on a page are filled', () => {
    // 60 paragraphs in a 2-column section with small height
    const paragraphs: ParagraphNode[] = [];
    for (let i = 1; i <= 60; i++) {
      paragraphs.push({
        type: 'paragraph',
        style: { spaceAfterPt: 6 },
        children: [{ type: 'run', text: `P${i}: Multi-column pagination test line.` }],
      });
    }

    const doc: DocumentNode = {
      type: 'document',
      sections: [
        {
          type: 'section',
          properties: {
            pageSize: { width: 500, height: 300 },
            margins: { top: 50, right: 50, bottom: 50, left: 50 },
            columns: { count: 2, spacePt: 20 },
          },
          children: paragraphs,
        },
      ],
    };

    const pages = defaultPageEngine.layoutDocument(doc);
    expect(pages.length).toBeGreaterThan(1);

    // Every full page should utilize both columns
    for (let p = 0; p < pages.length - 1; p++) {
      const page = pages[p]!;
      const hasCol0 = page.lines.some((l) => l.bounds.x < 150);
      const hasCol1 = page.lines.some((l) => l.bounds.x >= 250);
      expect(hasCol0).toBe(true);
      expect(hasCol1).toBe(true);
    }
  });
});
