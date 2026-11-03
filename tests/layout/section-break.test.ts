import { describe, expect, it } from 'bun:test';
import { StandardPageEngine, formatPageNumber } from '../../src/layout/page-engine.js';
import type { DocumentNode } from '../../src/types/ast.js';

describe('ISO/IEC 29500 Section Break Layout Engine', () => {
  it('should format page numbers correctly in decimal, roman, and letter', () => {
    expect(formatPageNumber(1, 'decimal')).toBe('1');
    expect(formatPageNumber(4, 'upperRoman')).toBe('IV');
    expect(formatPageNumber(9, 'lowerRoman')).toBe('ix');
    expect(formatPageNumber(1, 'upperLetter')).toBe('A');
    expect(formatPageNumber(2, 'lowerLetter')).toBe('b');
  });

  it('should layout landscape orientation and report it in PageLayout', () => {
    const doc: DocumentNode = {
      type: 'document',
      sections: [
        {
          type: 'section',
          properties: {
            pageSize: { width: 842, height: 595 },
            margins: { top: 72, right: 72, bottom: 72, left: 72 },
            orientation: 'landscape',
          },
          children: [
            {
              type: 'paragraph',
              children: [{ type: 'run', text: 'Landscape page content' }],
            },
          ],
        },
      ],
    };

    const engine = new StandardPageEngine();
    const pages = engine.layoutDocument(doc);

    expect(pages.length).toBe(1);
    expect(pages[0]?.orientation).toBe('landscape');
    expect(pages[0]?.size.width).toBe(842);
    expect(pages[0]?.size.height).toBe(595);
    expect(pages[0]?.pageNumber).toBe(1);
  });

  it('should continue on the same page for continuous section break with matching geometry', () => {
    const doc: DocumentNode = {
      type: 'document',
      sections: [
        {
          type: 'section',
          properties: {
            pageSize: { width: 612, height: 792 },
            margins: { top: 72, right: 72, bottom: 72, left: 72 },
          },
          children: [
            {
              type: 'paragraph',
              children: [{ type: 'run', text: 'Section 1 paragraph' }],
            },
          ],
        },
        {
          type: 'section',
          properties: {
            pageSize: { width: 612, height: 792 },
            margins: { top: 72, right: 72, bottom: 72, left: 72 },
            type: 'continuous',
            columns: { count: 2, spacePt: 20 },
          },
          children: [
            {
              type: 'paragraph',
              children: [{ type: 'run', text: 'Section 2 continuous paragraph in 2 columns' }],
            },
          ],
        },
      ],
    };

    const engine = new StandardPageEngine();
    const pages = engine.layoutDocument(doc);

    // Both sections should share the same physical page!
    expect(pages.length).toBe(1);
    expect(pages[0]?.lines.length).toBeGreaterThan(1);
    const combinedText = pages[0]?.lines.map((l) => l.fragments.map((f) => f.text).join('')).join(' ');
    expect(combinedText).toContain('Section 1 paragraph');
    expect(combinedText).toContain('Section 2 continuous paragraph');
  });

  it('should insert blank pages for evenPage and oddPage section breaks', () => {
    const doc: DocumentNode = {
      type: 'document',
      sections: [
        {
          type: 'section',
          properties: {
            pageSize: { width: 612, height: 792 },
            margins: { top: 72, right: 72, bottom: 72, left: 72 },
          },
          children: [
            {
              type: 'paragraph',
              children: [{ type: 'run', text: 'Section 1 on Page 1' }],
            },
          ],
        },
        {
          type: 'section',
          properties: {
            pageSize: { width: 612, height: 792 },
            margins: { top: 72, right: 72, bottom: 72, left: 72 },
            type: 'oddPage', // Page 1 ended -> next page would be Page 2 (even) -> must insert blank page so Section 2 starts on Page 3 (odd)!
          },
          children: [
            {
              type: 'paragraph',
              children: [{ type: 'run', text: 'Section 2 on Page 3' }],
            },
          ],
        },
      ],
    };

    const engine = new StandardPageEngine();
    const pages = engine.layoutDocument(doc);

    // Page 1 (content), Page 2 (blank), Page 3 (content)
    expect(pages.length).toBe(3);
    expect(pages[0]?.lines.length).toBeGreaterThan(0);
    expect(pages[1]?.lines.length).toBe(0); // blank spacer page
    expect(pages[2]?.lines.length).toBeGreaterThan(0);
  });

  it('should support page numbering restart and roman format in header/footer fields', () => {
    const doc: DocumentNode = {
      type: 'document',
      sections: [
        {
          type: 'section',
          properties: {
            pageSize: { width: 612, height: 792 },
            margins: { top: 72, right: 72, bottom: 72, left: 72 },
            pageNumbering: { start: 1, format: 'lowerRoman' },
          },
          headers: {
            default: {
              children: [
                {
                  type: 'paragraph',
                  children: [{ type: 'run', field: 'PAGE', text: '' }],
                },
              ],
            },
          },
          children: [
            {
              type: 'paragraph',
              children: [{ type: 'run', text: 'Document with roman page numbering' }],
            },
          ],
        },
      ],
    };

    const engine = new StandardPageEngine();
    const pages = engine.layoutDocument(doc);

    expect(pages.length).toBe(1);
    expect(pages[0]?.formattedPageNumber).toBe('i');
    expect(pages[0]?.headerLines).toBeDefined();
    expect(pages[0]?.headerLines?.[0]?.fragments[0]?.text).toBe('i');
  });
});
