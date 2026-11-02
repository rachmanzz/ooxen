import { describe, expect, it } from 'bun:test';
import { defaultHtmlRenderer } from '../../src/renderer/html/html-renderer.js';
import { defaultOoxenWriter } from '../../src/serializer/ooxen-writer.js';
import { defaultWmlBuilder } from '../../src/serializer/wml-builder.js';
import type { DocumentNode, TableNode } from '../../src/types/ast.js';

describe('Table Geometry Serializer & Round-trip', () => {
  it('should serialize table with properties, grid, and cell attributes to WordprocessingML', () => {
    const table: TableNode = {
      type: 'table',
      style: {
        alignment: 'center',
        widthPt: 300,
        borderTop: 'single #003366',
        borderBottom: 'single #003366',
        cellMarginTopPt: 4,
        cellMarginBottomPt: 4,
        cellMarginLeftPt: 6,
        cellMarginRightPt: 6,
      },
      columnWidthsPt: [100, 200],
      rows: [
        {
          type: 'table-row',
          heightPt: 40,
          cantSplit: true,
          tblHeader: true,
          children: [
            {
              type: 'table-cell',
              widthPt: 100,
              style: {
                verticalAlign: 'center',
                backgroundColor: '#EEEEEE',
                borderBottom: 'single #003366',
                paddingTopPt: 5,
              },
              children: [{ type: 'paragraph', children: [{ type: 'run', text: 'Head 1' }] }],
            },
            {
              type: 'table-cell',
              widthPt: 200,
              style: {
                verticalAlign: 'bottom',
                backgroundColor: '#DDDDDD',
              },
              children: [{ type: 'paragraph', children: [{ type: 'run', text: 'Head 2' }] }],
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

    // Verify w:tblPr
    expect(wml).toContain('<w:jc w:val="center"/>');
    expect(wml).toContain('<w:tblW w:w="6000" w:type="dxa"/>'); // 300 * 20 = 6000
    expect(wml).toContain('<w:top w:val="single" w:sz="4" w:space="0" w:color="003366"/>');
    expect(wml).toContain('<w:tblCellMar>');
    expect(wml).toContain('<w:top w:w="80" w:type="dxa"/>'); // 4 * 20 = 80
    expect(wml).toContain('<w:left w:w="120" w:type="dxa"/>'); // 6 * 20 = 120

    // Verify w:tblGrid
    expect(wml).toContain('<w:tblGrid>');
    expect(wml).toContain('<w:gridCol w:w="2000"/>'); // 100 * 20 = 2000
    expect(wml).toContain('<w:gridCol w:w="4000"/>'); // 200 * 20 = 4000

    // Verify w:trPr
    expect(wml).toContain('<w:trHeight w:val="800"/>'); // 40 * 20 = 800
    expect(wml).toContain('<w:cantSplit/>');
    expect(wml).toContain('<w:tblHeader/>');

    // Verify w:tcPr
    expect(wml).toContain('<w:tcW w:w="2000" w:type="dxa"/>');
    expect(wml).toContain('<w:vAlign w:val="center"/>');
    expect(wml).toContain('<w:shd w:fill="EEEEEE"/>');
    expect(wml).toContain('<w:vAlign w:val="bottom"/>');
  });

  it('should render and parse HTML table geometry with colgroup, alignment, and cell styles', async () => {
    const table: TableNode = {
      type: 'table',
      style: {
        alignment: 'center',
        widthPt: 400,
      },
      columnWidthsPt: [150, 250],
      rows: [
        {
          type: 'table-row',
          heightPt: 35,
          children: [
            {
              type: 'table-cell',
              widthPt: 150,
              style: {
                verticalAlign: 'center',
                backgroundColor: '#F5F5F5',
                paddingTopPt: 4,
                paddingLeftPt: 8,
              },
              children: [{ type: 'paragraph', children: [{ type: 'run', text: 'Left cell' }] }],
            },
            {
              type: 'table-cell',
              widthPt: 250,
              style: {
                verticalAlign: 'bottom',
              },
              children: [{ type: 'paragraph', children: [{ type: 'run', text: 'Right cell' }] }],
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
    expect(html).toContain('<table class="ooxen-table" style="');
    expect(html).toContain('margin-left: auto; margin-right: auto;');
    expect(html).toContain('<colgroup>');
    expect(html).toContain('<col style="width: 150pt;"/>');
    expect(html).toContain('<col style="width: 250pt;"/>');
    expect(html).toContain('style="height: 35pt;"');
    expect(html).toContain('vertical-align: middle;');
    expect(html).toContain('vertical-align: bottom;');

    // Verify writer can process this HTML to .docx
    const docxBytes = await defaultOoxenWriter.writeFromHtml(html);
    expect(docxBytes).toBeInstanceOf(Uint8Array);
    expect(docxBytes.length).toBeGreaterThan(100);
  });
});
