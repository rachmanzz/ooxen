import { describe, expect, it } from 'bun:test';
import { defaultPageEngine } from '../../src/layout/page-engine.js';
import type { DocumentNode, TableNode } from '../../src/types/ast.js';

describe('Table Geometry Layout Engine', () => {
  it('should layout columns proportionally according to columnWidthsPt', () => {
    const table: TableNode = {
      type: 'table',
      columnWidthsPt: [100, 200, 100], // total 400 pt
      rows: [
        {
          type: 'table-row',
          children: [
            {
              type: 'table-cell',
              children: [{ type: 'paragraph', children: [{ type: 'run', text: 'Col 1' }] }],
            },
            {
              type: 'table-cell',
              children: [{ type: 'paragraph', children: [{ type: 'run', text: 'Col 2' }] }],
            },
            {
              type: 'table-cell',
              children: [{ type: 'paragraph', children: [{ type: 'run', text: 'Col 3' }] }],
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
            margins: { top: 50, right: 50, bottom: 50, left: 50 }, // contentWidth = 400
          },
          children: [table],
        },
      ],
    };

    const pages = defaultPageEngine.layoutDocument(doc);
    expect(pages.length).toBe(1);
    const lines = pages[0]!.lines;
    expect(lines.length).toBe(3);

    // Col 1 start: left margin 50 + pad.left 4 = 54
    expect(lines[0]!.bounds.x).toBeCloseTo(54, 1);
    // Col 2 start: left margin 50 + 100 + pad.left 4 = 154
    expect(lines[1]!.bounds.x).toBeCloseTo(154, 1);
    // Col 3 start: left margin 50 + 100 + 200 + pad.left 4 = 354
    expect(lines[2]!.bounds.x).toBeCloseTo(354, 1);
  });

  it('should position table start X according to table alignment', () => {
    // Total table width = 200, contentWidth = 400 (500 - 50 - 50)
    // Left alignment: startX = 50
    // Center alignment: remaining = 200, startX = 50 + 100 = 150
    // Right alignment: remaining = 200, startX = 50 + 200 = 250
    const makeDocWithAlign = (alignment: 'left' | 'center' | 'right'): DocumentNode => ({
      type: 'document',
      sections: [
        {
          type: 'section',
          properties: {
            pageSize: { width: 500, height: 700 },
            margins: { top: 50, right: 50, bottom: 50, left: 50 },
          },
          children: [
            {
              type: 'table',
              style: { alignment, widthPt: 200 },
              columnWidthsPt: [100, 100],
              rows: [
                {
                  type: 'table-row',
                  children: [
                    {
                      type: 'table-cell',
                      children: [{ type: 'paragraph', children: [{ type: 'run', text: 'A' }] }],
                    },
                    {
                      type: 'table-cell',
                      children: [{ type: 'paragraph', children: [{ type: 'run', text: 'B' }] }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });

    const leftPages = defaultPageEngine.layoutDocument(makeDocWithAlign('left'));
    expect(leftPages[0]!.lines[0]!.bounds.x).toBeCloseTo(54, 1); // 50 + 4

    const centerPages = defaultPageEngine.layoutDocument(makeDocWithAlign('center'));
    expect(centerPages[0]!.lines[0]!.bounds.x).toBeCloseTo(154, 1); // 50 + 100 + 4

    const rightPages = defaultPageEngine.layoutDocument(makeDocWithAlign('right'));
    expect(rightPages[0]!.lines[0]!.bounds.x).toBeCloseTo(254, 1); // 50 + 200 + 4
  });

  it('should apply cell vertical alignment (top, center, bottom) within row', () => {
    const table: TableNode = {
      type: 'table',
      rows: [
        {
          type: 'table-row',
          heightPt: 80, // explicit tall row height
          children: [
            {
              type: 'table-cell',
              style: { verticalAlign: 'top', paddingTopPt: 10, paddingBottomPt: 10 },
              children: [{ type: 'paragraph', children: [{ type: 'run', text: 'Top Aligned' }] }],
            },
            {
              type: 'table-cell',
              style: { verticalAlign: 'center', paddingTopPt: 10, paddingBottomPt: 10 },
              children: [{ type: 'paragraph', children: [{ type: 'run', text: 'Center Aligned' }] }],
            },
            {
              type: 'table-cell',
              style: { verticalAlign: 'bottom', paddingTopPt: 10, paddingBottomPt: 10 },
              children: [{ type: 'paragraph', children: [{ type: 'run', text: 'Bottom Aligned' }] }],
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
    const lines = pages[0]!.lines;
    expect(lines.length).toBe(3);

    const lineTop = lines[0]!;
    const lineCenter = lines[1]!;
    const lineBottom = lines[2]!;

    // Top: Y should be margins.top (50) + padTop (10) = 60
    expect(lineTop.bounds.y).toBeCloseTo(60, 1);
    // Center: Y should be between top and bottom
    expect(lineCenter.bounds.y).toBeGreaterThan(lineTop.bounds.y);
    // Bottom: Y should be greatest
    expect(lineBottom.bounds.y).toBeGreaterThan(lineCenter.bounds.y);
  });
});
