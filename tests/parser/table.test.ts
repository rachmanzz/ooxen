import { describe, expect, it } from 'bun:test';
import { defaultXmlAdapter } from '../../src/parser/xml-adapter.js';
import { StandardTableParser } from '../../src/parser/wml/table-parser.js';

describe('OOXML Table Parser', () => {
  it('should parse table rows, cells, and gridSpan', () => {
    const xml = `
<w:tbl xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:tr>
    <w:tc>
      <w:tcPr>
        <w:gridSpan w:val="2"/>
        <w:shd w:fill="F2F2F2"/>
      </w:tcPr>
      <w:p>
        <w:r><w:t>Header merged</w:t></w:r>
      </w:p>
    </w:tc>
  </w:tr>
  <w:tr>
    <w:tc>
      <w:p>
        <w:r><w:t>Col 1</w:t></w:r>
      </w:p>
    </w:tc>
    <w:tc>
      <w:p>
        <w:r><w:t>Col 2</w:t></w:r>
      </w:p>
    </w:tc>
  </w:tr>
</w:tbl>`;

    const node = defaultXmlAdapter.parse(xml);
    const parser = new StandardTableParser();
    const table = parser.parseTable(node);

    expect(table.type).toBe('table');
    expect(table.rows.length).toBe(2);

    // Row 0
    const row0 = table.rows[0];
    expect(row0?.children.length).toBe(1);
    const cell0 = row0?.children[0];
    expect(cell0?.colSpan).toBe(2);
    expect(cell0?.style?.backgroundColor).toBe('#F2F2F2');
    expect(cell0?.children.length).toBe(1);

    // Row 1
    const row1 = table.rows[1];
    expect(row1?.children.length).toBe(2);
    const cell10 = row1?.children[0];
    const cell11 = row1?.children[1];
    expect(cell10?.colSpan).toBeUndefined();
    expect(cell11?.colSpan).toBeUndefined();
  });
});
