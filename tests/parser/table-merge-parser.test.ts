import { describe, expect, it } from 'bun:test';
import { defaultXmlAdapter } from '../../src/parser/xml-adapter.js';
import { StandardTableParser } from '../../src/parser/wml/table-parser.js';

describe('Table Vertical Merging (w:vMerge) & Nested Tables Parser', () => {
  it('should parse w:vMerge restart and continue, computing correct rowSpan on cells', () => {
    const xml = `
<w:tbl xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <!-- Row 0: Cell 0 restarts merge for 3 rows; Cell 1 is normal -->
  <w:tr>
    <w:tc>
      <w:tcPr>
        <w:vMerge w:val="restart"/>
      </w:tcPr>
      <w:p><w:r><w:t>Merged Span 3</w:t></w:r></w:p>
    </w:tc>
    <w:tc>
      <w:p><w:r><w:t>R0C1</w:t></w:r></w:p>
    </w:tc>
  </w:tr>
  <!-- Row 1: Cell 0 continues; Cell 1 is normal -->
  <w:tr>
    <w:tc>
      <w:tcPr>
        <w:vMerge w:val="continue"/>
      </w:tcPr>
      <w:p/>
    </w:tc>
    <w:tc>
      <w:p><w:r><w:t>R1C1</w:t></w:r></w:p>
    </w:tc>
  </w:tr>
  <!-- Row 2: Cell 0 continues (default val is continue); Cell 1 is normal -->
  <w:tr>
    <w:tc>
      <w:tcPr>
        <w:vMerge/>
      </w:tcPr>
      <w:p/>
    </w:tc>
    <w:tc>
      <w:p><w:r><w:t>R2C1</w:t></w:r></w:p>
    </w:tc>
  </w:tr>
  <!-- Row 3: Normal row, vertical merge has ended -->
  <w:tr>
    <w:tc>
      <w:p><w:r><w:t>R3C0</w:t></w:r></w:p>
    </w:tc>
    <w:tc>
      <w:p><w:r><w:t>R3C1</w:t></w:r></w:p>
    </w:tc>
  </w:tr>
</w:tbl>`;

    const node = defaultXmlAdapter.parse(xml);
    const parser = new StandardTableParser();
    const table = parser.parseTable(node);

    expect(table.rows.length).toBe(4);

    // Row 0
    const r0c0 = table.rows[0]!.children[0]!;
    expect(r0c0.vMerge).toBe('restart');
    expect(r0c0.rowSpan).toBe(3);

    // Row 1
    const r1c0 = table.rows[1]!.children[0]!;
    expect(r1c0.vMerge).toBe('continue');
    expect(r1c0.rowSpan).toBe(0);

    // Row 2
    const r2c0 = table.rows[2]!.children[0]!;
    expect(r2c0.vMerge).toBe('continue');
    expect(r2c0.rowSpan).toBe(0);

    // Row 3
    const r3c0 = table.rows[3]!.children[0]!;
    expect(r3c0.vMerge).toBeUndefined();
    expect(r3c0.rowSpan).toBeUndefined();
  });

  it('should parse nested table inside a table cell', () => {
    const xml = `
<w:tbl xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:tr>
    <w:tc>
      <w:p><w:r><w:t>Outer before</w:t></w:r></w:p>
      <!-- Nested table -->
      <w:tbl>
        <w:tr>
          <w:tc>
            <w:p><w:r><w:t>Inner nested cell</w:t></w:r></w:p>
          </w:tc>
        </w:tr>
      </w:tbl>
    </w:tc>
  </w:tr>
</w:tbl>`;

    const node = defaultXmlAdapter.parse(xml);
    const parser = new StandardTableParser();
    const table = parser.parseTable(node);

    expect(table.rows.length).toBe(1);
    const cell = table.rows[0]!.children[0]!;
    expect(cell.children.length).toBe(2);
    expect(cell.children[0]!.type).toBe('paragraph');
    expect(cell.children[1]!.type).toBe('table');

    const innerTable = cell.children[1] as typeof table;
    expect(innerTable.rows.length).toBe(1);
    expect(innerTable.rows[0]!.children.length).toBe(1);
  });
});
