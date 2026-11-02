import { describe, expect, it } from 'bun:test';
import { defaultXmlAdapter } from '../../src/parser/xml-adapter.js';
import { StandardTableParser } from '../../src/parser/wml/table-parser.js';

describe('Table Geometry & Properties Parser', () => {
  it('should parse w:tblPr (alignment, width, borders, margins) and w:tblGrid', () => {
    const xml = `
<w:tbl xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:tblPr>
    <w:jc w:val="center"/>
    <w:tblW w:w="8000" w:type="dxa"/>
    <w:tblBorders>
      <w:top w:val="single" w:color="002060"/>
      <w:left w:val="none"/>
      <w:bottom w:val="single" w:color="002060"/>
      <w:right w:val="none"/>
      <w:insideH w:val="single" w:color="CCCCCC"/>
      <w:insideV w:val="none"/>
    </w:tblBorders>
    <w:tblCellMar>
      <w:top w:w="120" w:type="dxa"/>
      <w:left w:w="200" w:type="dxa"/>
      <w:bottom w:w="120" w:type="dxa"/>
      <w:right w:w="200" w:type="dxa"/>
    </w:tblCellMar>
  </w:tblPr>
  <w:tblGrid>
    <w:gridCol w:w="2000"/>
    <w:gridCol w:w="4000"/>
    <w:gridCol w:w="2000"/>
  </w:tblGrid>
  <w:tr>
    <w:tc>
      <w:p><w:r><w:t>A</w:t></w:r></w:p>
    </w:tc>
  </w:tr>
</w:tbl>`;

    const node = defaultXmlAdapter.parse(xml);
    const parser = new StandardTableParser();
    const table = parser.parseTable(node);

    expect(table.style).toBeDefined();
    expect(table.style?.alignment).toBe('center');
    expect(table.style?.widthPt).toBe(400); // 8000 / 20 = 400 pt
    expect(table.style?.borderTop).toBe('single #002060');
    expect(table.style?.borderLeft).toBe('none');
    expect(table.style?.cellMarginTopPt).toBe(6); // 120 / 20 = 6 pt
    expect(table.style?.cellMarginLeftPt).toBe(10); // 200 / 20 = 10 pt

    expect(table.columnWidthsPt).toBeDefined();
    expect(table.columnWidthsPt).toEqual([100, 200, 100]); // 2000/20, 4000/20, 2000/20
  });

  it('should parse w:trPr (trHeight, cantSplit, tblHeader)', () => {
    const xml = `
<w:tbl xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:tr>
    <w:trPr>
      <w:trHeight w:val="600"/>
      <w:cantSplit/>
      <w:tblHeader/>
    </w:trPr>
    <w:tc>
      <w:p><w:r><w:t>Header Cell</w:t></w:r></w:p>
    </w:tc>
  </w:tr>
</w:tbl>`;

    const node = defaultXmlAdapter.parse(xml);
    const parser = new StandardTableParser();
    const table = parser.parseTable(node);

    expect(table.rows.length).toBe(1);
    const row = table.rows[0]!;
    expect(row.heightPt).toBe(30); // 600 / 20 = 30 pt
    expect(row.cantSplit).toBe(true);
    expect(row.tblHeader).toBe(true);
  });

  it('should parse w:tcPr (tcW, vAlign, tcBorders, tcMar)', () => {
    const xml = `
<w:tbl xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:tr>
    <w:tc>
      <w:tcPr>
        <w:tcW w:w="3000" w:type="dxa"/>
        <w:vAlign w:val="center"/>
        <w:tcBorders>
          <w:bottom w:val="single" w:color="FF0000"/>
        </w:tcBorders>
        <w:tcMar>
          <w:top w:w="100"/>
          <w:bottom w:w="100"/>
          <w:left w:w="160"/>
          <w:right w:w="160"/>
        </w:tcMar>
      </w:tcPr>
      <w:p><w:r><w:t>Centered cell</w:t></w:r></w:p>
    </w:tc>
  </w:tr>
</w:tbl>`;

    const node = defaultXmlAdapter.parse(xml);
    const parser = new StandardTableParser();
    const table = parser.parseTable(node);

    const cell = table.rows[0]!.children[0]!;
    expect(cell.widthPt).toBe(150); // 3000 / 20 = 150 pt
    expect(cell.style?.verticalAlign).toBe('center');
    expect(cell.style?.borderBottom).toBe('single #FF0000');
    expect(cell.style?.paddingTopPt).toBe(5); // 100 / 20 = 5 pt
    expect(cell.style?.paddingLeftPt).toBe(8); // 160 / 20 = 8 pt
  });
});
