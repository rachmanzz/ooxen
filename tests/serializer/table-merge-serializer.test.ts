import { describe, expect, it } from 'bun:test';
import { defaultHtmlRenderer } from '../../src/renderer/html/html-renderer.js';
import { defaultOoxenWriter } from '../../src/serializer/ooxen-writer.js';
import { defaultWmlBuilder } from '../../src/serializer/wml-builder.js';
import type { DocumentNode, TableNode } from '../../src/types/ast.js';

describe('Table Vertical Merge & Nested Serializer', () => {
  it('should serialize w:vMerge restart and continue in WordprocessingML', () => {
    const table: TableNode = {
      type: 'table',
      rows: [
        {
          type: 'table-row',
          children: [
            {
              type: 'table-cell',
              vMerge: 'restart',
              rowSpan: 2,
              children: [{ type: 'paragraph', children: [{ type: 'run', text: 'Merged Vertically' }] }],
            },
            {
              type: 'table-cell',
              children: [{ type: 'paragraph', children: [{ type: 'run', text: 'Top' }] }],
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
              children: [],
            },
            {
              type: 'table-cell',
              children: [{ type: 'paragraph', children: [{ type: 'run', text: 'Bottom' }] }],
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
            pageSize: { width: 612, height: 792 },
            margins: { top: 72, right: 72, bottom: 72, left: 72 },
          },
          children: [table],
        },
      ],
    };

    const wml = defaultWmlBuilder.buildDocumentXml(doc);
    expect(wml).toContain('<w:vMerge w:val="restart"/>');
    expect(wml).toContain('<w:vMerge/>');
  });

  it('should render HTML table with rowspan and omit continuation cells', () => {
    const table: TableNode = {
      type: 'table',
      rows: [
        {
          type: 'table-row',
          children: [
            {
              type: 'table-cell',
              vMerge: 'restart',
              rowSpan: 2,
              children: [{ type: 'paragraph', children: [{ type: 'run', text: 'Spanned 2 Rows' }] }],
            },
            {
              type: 'table-cell',
              children: [{ type: 'paragraph', children: [{ type: 'run', text: 'Row 0' }] }],
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
              children: [],
            },
            {
              type: 'table-cell',
              children: [{ type: 'paragraph', children: [{ type: 'run', text: 'Row 1' }] }],
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
            pageSize: { width: 612, height: 792 },
            margins: { top: 72, right: 72, bottom: 72, left: 72 },
          },
          children: [table],
        },
      ],
    };

    const html = defaultHtmlRenderer.renderToHtmlString(doc);
    // Restart cell must have rowspan="2"
    expect(html).toContain('rowspan="2"');
    // Row 1 should only contain 1 <td> (Row 1), because the continuation cell is omitted in HTML
    const row1Html = html.split('<tr class="ooxen-tr">')[2]!;
    expect(row1Html).toContain('Row 1');
    const tdCountInRow1 = (row1Html.match(/<td/g) || []).length;
    expect(tdCountInRow1).toBe(1);
  });

  it('should convert HTML with rowspan into OOXML with full grid and w:vMerge', async () => {
    const html = `
<article class="ooxen-document">
  <section class="ooxen-section">
    <table class="ooxen-table">
      <tbody>
        <tr class="ooxen-tr">
          <td class="ooxen-tc" rowspan="2"><p class="ooxen-p"><span class="ooxen-r">Vertical Span</span></p></td>
          <td class="ooxen-tc"><p class="ooxen-p"><span class="ooxen-r">R0 Col 1</span></p></td>
        </tr>
        <tr class="ooxen-tr">
          <td class="ooxen-tc"><p class="ooxen-p"><span class="ooxen-r">R1 Col 1</span></p></td>
        </tr>
      </tbody>
    </table>
  </section>
</article>`;

    const docxBytes = await defaultOoxenWriter.writeFromHtml(html);
    expect(docxBytes).toBeInstanceOf(Uint8Array);
    expect(docxBytes.length).toBeGreaterThan(100);
  });
});
