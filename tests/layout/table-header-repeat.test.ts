import { describe, expect, it } from 'bun:test';
import { StandardPageEngine } from '../../src/layout/page-engine.js';
import type { DocumentNode, TableRowNode } from '../../src/types/ast.js';

// F-TBLHDR: leading tblHeader rows must repeat at the top of every page the
// table spans. 40 body rows over ~648pt of content height force a break.
function headerTableDoc(): DocumentNode {
  const headerRow: TableRowNode = {
    type: 'table-row',
    tblHeader: true,
    children: [
      {
        type: 'table-cell',
        children: [{ type: 'paragraph', children: [{ type: 'run', text: 'HDR-COL' }] }],
      },
    ],
  };
  const rows: TableRowNode[] = [headerRow];
  for (let i = 0; i < 40; i++) {
    rows.push({
      type: 'table-row',
      children: [
        {
          type: 'table-cell',
          children: [{ type: 'paragraph', children: [{ type: 'run', text: `row ${i}` }] }],
        },
      ],
    });
  }
  return {
    type: 'document',
    sections: [
      {
        type: 'section',
        properties: {
          pageSize: { width: 612, height: 792 },
          margins: { top: 72, right: 72, bottom: 72, left: 72 },
        },
        children: [{ type: 'table', rows }],
      },
    ],
  };
}

const headerHits = (page: { lines: { fragments: { text?: string }[] }[] }): number =>
  page.lines.reduce(
    (n, l) => n + l.fragments.filter((f) => f.text?.includes('HDR-COL')).length,
    0,
  );

describe('Table header-row repeat (F-TBLHDR)', () => {
  it('repeats leading tblHeader rows on continuation pages', () => {
    const pages = new StandardPageEngine().layoutDocument(headerTableDoc());
    expect(pages.length).toBeGreaterThan(1);
    // Header on the first page (normal flow) and repeated on page two.
    expect(headerHits(pages[0]!)).toBeGreaterThan(0);
    expect(headerHits(pages[1]!)).toBeGreaterThan(0);
  });

  it('does not repeat without tblHeader rows', () => {
    const doc = headerTableDoc();
    const table = doc.sections[0]!.children[0]!;
    if (table.type === 'table') {
      for (const row of table.rows) delete (row as { tblHeader?: boolean }).tblHeader;
    }
    const pages = new StandardPageEngine().layoutDocument(doc);
    const total = pages.reduce((n, p) => n + headerHits(p), 0);
    expect(total).toBe(1);
  });
});
