import { describe, expect, it } from 'bun:test';
import { defaultPageEngine } from '../../src/layout/page-engine.js';
import type { DocumentNode } from '../../src/types/ast.js';

describe('ISO/IEC 29500 Pagination Controls & Explicit Breaks Layout', () => {
  const pageSize = { width: 612, height: 792 }; // Letter
  const margins = { top: 72, right: 72, bottom: 72, left: 72 }; // Content height = 648 pt

  describe('pageBreakBefore', () => {
    it('should force a paragraph to start on a new page when pageBreakBefore is true', () => {
      const doc: DocumentNode = {
        type: 'document',
        sections: [
          {
            type: 'section',
            properties: { pageSize, margins },
            children: [
              {
                type: 'paragraph',
                children: [{ type: 'run', text: 'Page 1 Paragraph' }],
              },
              {
                type: 'paragraph',
                style: { pageBreakBefore: true },
                children: [{ type: 'run', text: 'Page 2 Paragraph with pageBreakBefore' }],
              },
            ],
          },
        ],
      };

      const pages = defaultPageEngine.layoutDocument(doc);

      expect(pages.length).toBe(2);
      const page1Text = pages[0]?.lines[0]?.fragments.map((f) => f.text).join('');
      const page2Text = pages[1]?.lines[0]?.fragments.map((f) => f.text).join('');
      expect(page1Text).toContain('Page 1 Paragraph');
      expect(page2Text).toContain('Page 2 Paragraph with pageBreakBefore');
      expect(pages[1]?.lines[0]?.bounds.y).toBe(margins.top); // Starts at the top margin of page 2
    });
  });

  describe('Explicit Run Page Break (w:br w:type="page")', () => {
    it('should split lines within a paragraph across pages on breakType="page"', () => {
      const doc: DocumentNode = {
        type: 'document',
        sections: [
          {
            type: 'section',
            properties: { pageSize, margins },
            children: [
              {
                type: 'paragraph',
                children: [
                  { type: 'run', text: 'Text before page break' },
                  { type: 'run', text: '', breakType: 'page' },
                  { type: 'run', text: 'Text after page break' },
                ],
              },
            ],
          },
        ],
      };

      const pages = defaultPageEngine.layoutDocument(doc);

      expect(pages.length).toBe(2);
      expect(pages[0]?.lines.length).toBeGreaterThan(0);
      const p1Text = pages[0]?.lines[0]?.fragments.map((f) => f.text).join('');
      expect(p1Text).toContain('Text before page break');

      expect(pages[1]?.lines.length).toBeGreaterThan(0);
      const p2Text = pages[1]?.lines[0]?.fragments.map((f) => f.text).join('');
      expect(p2Text).toContain('Text after page break');
    });
  });

  describe('Explicit Column Break (w:br w:type="column")', () => {
    it('should advance to the next column in a multi-column section on breakType="column"', () => {
      const doc: DocumentNode = {
        type: 'document',
        sections: [
          {
            type: 'section',
            properties: {
              pageSize,
              margins,
              columns: { count: 2, spacePt: 36, equalWidth: true },
            },
            children: [
              {
                type: 'paragraph',
                children: [
                  { type: 'run', text: 'Column 1 text' },
                  { type: 'run', text: '', breakType: 'column' },
                  { type: 'run', text: 'Column 2 text' },
                ],
              },
            ],
          },
        ],
      };

      const pages = defaultPageEngine.layoutDocument(doc);

      expect(pages.length).toBe(1); // Stays on the same page, but in column 2
      expect(pages[0]?.lines.length).toBe(2);

      const col1Line = pages[0]?.lines[0];
      const col2Line = pages[0]?.lines[1];

      const col1Text = col1Line?.fragments.map((f) => f.text).join('');
      const col2Text = col2Line?.fragments.map((f) => f.text).join('');
      expect(col1Text).toContain('Column 1 text');
      expect(col2Text).toContain('Column 2 text');

      // Col 2 start X should be greater than Col 1 start X
      expect(col2Line!.bounds.x).toBeGreaterThan(col1Line!.bounds.x);
    });
  });

  describe('keepLines', () => {
    it('should keep all lines of a paragraph together on the next page if they would split', () => {
      // Content height = 648 pt
      // Fill current page down to near the bottom with spaceAfterPt
      const fillParagraph = {
        type: 'paragraph' as const,
        style: { spaceAfterPt: 620 }, // Leaves only ~15 pt on page 1
        children: [{ type: 'run' as const, text: 'Top filler' }],
      };

      // Paragraph with 3 lines (~45 pt total), which would split if not kept together
      const keepParagraph = {
        type: 'paragraph' as const,
        style: { keepLines: true },
        children: [{ type: 'run' as const, text: 'First line\nSecond line\nThird line' }],
      };

      const doc: DocumentNode = {
        type: 'document',
        sections: [
          {
            type: 'section',
            properties: { pageSize, margins },
            children: [fillParagraph, keepParagraph],
          },
        ],
      };

      const pages = defaultPageEngine.layoutDocument(doc);

      expect(pages.length).toBe(2);
      // keepParagraph should be cleanly placed on page 2 in its entirety
      expect(pages[1]?.lines.length).toBe(3);
      expect(pages[1]?.lines[0]?.fragments.map((f) => f.text).join('')).toBe('First line');
      expect(pages[1]?.lines[1]?.fragments.map((f) => f.text).join('')).toBe('Second line');
      expect(pages[1]?.lines[2]?.fragments.map((f) => f.text).join('')).toBe('Third line');
    });
  });
});
