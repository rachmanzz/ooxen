import { describe, expect, it } from 'bun:test';
import { defaultPageEngine } from '../../src/layout/page-engine.js';
import type { DocumentNode, TableNode } from '../../src/types/ast.js';

describe('Table Vertical Merge & Nested Layout', () => {
  it('should layout vertically merged table cells without duplicate lines from continue cells', () => {
    const table: TableNode = {
      type: 'table',
      columnWidthsPt: [150, 150],
      rows: [
        {
          type: 'table-row',
          children: [
            {
              type: 'table-cell',
              vMerge: 'restart',
              rowSpan: 2,
              children: [{ type: 'paragraph', children: [{ type: 'run', text: 'Spanning Cell' }] }],
            },
            {
              type: 'table-cell',
              children: [{ type: 'paragraph', children: [{ type: 'run', text: 'Row 0 Col 1' }] }],
            },
          ],
        },
        {
          type: 'table-row',
          children: [
            {
              type: 'table-cell',
              vMerge: 'continue',
              rowSpan: 0,
              children: [], // continuation cell
            },
            {
              type: 'table-cell',
              children: [{ type: 'paragraph', children: [{ type: 'run', text: 'Row 1 Col 1' }] }],
            },
          ],
        },
      ],
    };

    const doc: DocumentNode = {
      type: 'document',
      sections: [
        {
          type: 'section',
          properties: {
            pageSize: { width: 500, height: 700 },
            margins: { top: 50, right: 50, bottom: 50, left: 50 },
          },
          children: [table],
        },
      ],
    };

    const pages = defaultPageEngine.layoutDocument(doc);
    expect(pages.length).toBe(1);
    const lines = pages[0]!.lines;

    // Total lines should be 3: "Spanning Cell", "Row 0 Col 1", "Row 1 Col 1"
    expect(lines.length).toBe(3);

    const spanLine = lines.find((l) => l.fragments.map((f) => f.text).join('').includes('Spanning Cell'));
    const r0c1Line = lines.find((l) => l.fragments.map((f) => f.text).join('').includes('Row 0 Col 1'));
    const r1c1Line = lines.find((l) => l.fragments.map((f) => f.text).join('').includes('Row 1 Col 1'));

    expect(spanLine).toBeDefined();
    expect(r0c1Line).toBeDefined();
    expect(r1c1Line).toBeDefined();

    // Span line starts at column 0 (margins.left 50 + 4 = 54)
    expect(spanLine!.bounds.x).toBeCloseTo(54, 1);
    // Row 0 Col 1 starts at column 1 (margins.left 50 + 150 + 4 = 204)
    expect(r0c1Line!.bounds.x).toBeCloseTo(204, 1);
    // Row 1 Col 1 also starts at column 1 (margins.left 50 + 150 + 4 = 204)
    expect(r1c1Line!.bounds.x).toBeCloseTo(204, 1);
    // Row 1 Col 1 is below Row 0 Col 1
    expect(r1c1Line!.bounds.y).toBeGreaterThan(r0c1Line!.bounds.y);
  });

  it('should layout nested table inside parent cell properly', () => {
    const nestedTable: TableNode = {
      type: 'table',
      columnWidthsPt: [60, 60],
      rows: [
        {
          type: 'table-row',
          children: [
            {
              type: 'table-cell',
              children: [{ type: 'paragraph', children: [{ type: 'run', text: 'Inner L' }] }],
            },
            {
              type: 'table-cell',
              children: [{ type: 'paragraph', children: [{ type: 'run', text: 'Inner R' }] }],
            },
          ],
        },
      ],
    };

    const outerTable: TableNode = {
      type: 'table',
      columnWidthsPt: [200, 200],
      rows: [
        {
          type: 'table-row',
          children: [
            {
              type: 'table-cell',
              children: [
                { type: 'paragraph', children: [{ type: 'run', text: 'Outer Header' }] },
                nestedTable,
              ],
            },
            {
              type: 'table-cell',
              children: [{ type: 'paragraph', children: [{ type: 'run', text: 'Outer Right' }] }],
            },
          ],
        },
      ],
    };

    const doc: DocumentNode = {
      type: 'document',
      sections: [
        {
          type: 'section',
          properties: {
            pageSize: { width: 500, height: 700 },
            margins: { top: 50, right: 50, bottom: 50, left: 50 },
          },
          children: [outerTable],
        },
      ],
    };

    const pages = defaultPageEngine.layoutDocument(doc);
    expect(pages.length).toBe(1);
    const lines = pages[0]!.lines;

    const innerLLine = lines.find((l) => l.fragments.map((f) => f.text).join('').includes('Inner L'));
    const innerRLine = lines.find((l) => l.fragments.map((f) => f.text).join('').includes('Inner R'));

    expect(innerLLine).toBeDefined();
    expect(innerRLine).toBeDefined();

    // Both inner cells should be within the bounds of column 0 (< 250)
    expect(innerLLine!.bounds.x).toBeLessThan(250);
    expect(innerRLine!.bounds.x).toBeLessThan(250);
    expect(innerRLine!.bounds.x).toBeGreaterThan(innerLLine!.bounds.x);
  });
});
