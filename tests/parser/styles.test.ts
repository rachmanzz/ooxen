import { describe, expect, it } from 'bun:test';
import { defaultXmlAdapter } from '../../src/parser/xml-adapter.js';
import { StandardStyleResolver } from '../../src/parser/wml/style-resolver.js';
import { StandardTableParser } from '../../src/parser/wml/table-parser.js';

describe('OOXML Style Resolver', () => {
  it('should resolve cascading styles with basedOn inheritance', () => {
    const xml = `
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault>
      <w:rPr>
        <w:rFonts w:ascii="Calibri"/>
        <w:sz w:val="22"/>
      </w:rPr>
    </w:rPrDefault>
    <w:pPrDefault>
      <w:pPr>
        <w:jc w:val="left"/>
      </w:pPr>
    </w:pPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:pPr>
      <w:spacing w:after="160" w:line="240"/>
    </w:pPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr>
      <w:spacing w:before="240" w:after="80"/>
      <w:jc w:val="center"/>
    </w:pPr>
    <w:rPr>
      <w:rFonts w:ascii="Arial"/>
      <w:b/>
      <w:sz w:val="32"/>
      <w:color w:val="2E74B5"/>
    </w:rPr>
  </w:style>
</w:styles>`;

    const rootNode = defaultXmlAdapter.parse(xml);
    const resolver = new StandardStyleResolver();
    resolver.loadStyles(rootNode);

    // Normal paragraph style
    const normalP = resolver.resolveParagraphStyle('Normal');
    expect(normalP.alignment).toBe('left');
    expect(normalP.spaceAfterPt).toBe(8); // 160 / 20

    // Heading 1 paragraph style (inherits line spacing from Normal, overrides spacing & alignment)
    const headingP = resolver.resolveParagraphStyle('Heading1');
    expect(headingP.alignment).toBe('center');
    expect(headingP.spaceBeforePt).toBe(12); // 240 / 20
    expect(headingP.spaceAfterPt).toBe(4); // 80 / 20
    expect(headingP.lineSpacingPt).toBe(13.2); // w:line="240" without lineRule = auto = 240ths of a line ≈ 13.2pt single spacing

    // Heading 1 run style
    const headingR = resolver.resolveRunStyle('Heading1');
    expect(headingR.fontFamily).toBe('Arial');
    expect(headingR.bold).toBe(true);
    expect(headingR.fontSizePt).toBe(16); // 32 / 2
    expect(headingR.color).toBe('#2E74B5');
  });

  it('resolves named table styles (w:tblStyle) and lets inline w:tblPr win (v2 N8)', () => {
    const xml = `
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="table" w:styleId="BaseGrid">
    <w:name w:val="Table Grid"/>
    <w:tblPr>
      <w:tblBorders>
        <w:top w:val="single" w:sz="4" w:color="000000"/>
        <w:left w:val="single" w:sz="4" w:color="000000"/>
        <w:bottom w:val="single" w:sz="4" w:color="000000"/>
        <w:right w:val="single" w:sz="4" w:color="000000"/>
        <w:insideH w:val="single" w:sz="4" w:color="000000"/>
        <w:insideV w:val="single" w:sz="4" w:color="000000"/>
      </w:tblBorders>
      <w:tblCellMar>
        <w:top w:w="80" w:type="dxa"/>
        <w:left w:w="120" w:type="dxa"/>
      </w:tblCellMar>
    </w:tblPr>
  </w:style>
  <w:style w:type="table" w:styleId="FancyGrid">
    <w:name w:val="Fancy Grid"/>
    <w:basedOn w:val="BaseGrid"/>
    <w:tblPr>
      <w:tblBorders>
        <w:top w:val="double" w:sz="8" w:color="003366"/>
      </w:tblBorders>
    </w:tblPr>
  </w:style>
</w:styles>`;

    const rootNode = defaultXmlAdapter.parse(xml);
    const resolver = new StandardStyleResolver();
    resolver.loadStyles(rootNode);

    const base = resolver.resolveTableStyle('BaseGrid');
    expect(base.borderTop).toBe('single #000000 0.5pt');
    expect(base.borderInsideH).toBe('single #000000 0.5pt');
    expect(base.cellMarginLeftPt).toBe(6); // 120 / 20

    // basedOn inheritance: FancyGrid overrides only the top border.
    const fancy = resolver.resolveTableStyle('FancyGrid');
    expect(fancy.borderTop).toBe('double #003366 1pt');
    expect(fancy.borderLeft).toBe('single #000000 0.5pt'); // inherited
    expect(fancy.cellMarginLeftPt).toBe(6); // inherited
    expect(resolver.resolveTableStyle()).toEqual({});
  });

  it('merges the resolved table style into parsed tables, inline properties winning', () => {
    const xml = `
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:tbl>
      <w:tblPr>
        <w:tblStyle w:val="Grid"/>
        <w:tblW w:w="3000" w:type="dxa"/>
      </w:tblPr>
      <w:tr>
        <w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr><w:p/></w:tc>
      </w:tr>
    </w:tbl>
  </w:body>
</w:document>`;

    const stylesXml = `
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="table" w:styleId="Grid">
    <w:tblPr>
      <w:tblBorders>
        <w:top w:val="single" w:sz="4" w:color="000000"/>
        <w:insideH w:val="dotted" w:sz="4" w:color="FF0000"/>
      </w:tblBorders>
    </w:tblPr>
  </w:style>
</w:styles>`;

    const resolver = new StandardStyleResolver();
    resolver.loadStyles(defaultXmlAdapter.parse(stylesXml));

    const rootNode = defaultXmlAdapter.parse(xml);
    const body = rootNode.children.find((c) => c.nodeName.toLowerCase().endsWith('body'))!;
    const tblNode = body.children.find((c) => c.nodeName.toLowerCase().endsWith('tbl'))!;

    const table = new StandardTableParser().parseTable(tblNode, resolver);

    expect(table.style?.borderTop).toBe('single #000000 0.5pt');
    expect(table.style?.borderInsideH).toBe('dotted #FF0000 0.5pt');
    expect(table.style?.widthPt).toBe(150); // inline w:tblW wins: 3000 / 20
  });
});
