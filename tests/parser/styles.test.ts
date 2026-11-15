import { describe, expect, it } from 'bun:test';
import { defaultXmlAdapter } from '../../src/parser/xml-adapter.js';
import { StandardStyleResolver } from '../../src/parser/wml/style-resolver.js';
import { StandardTableParser } from '../../src/parser/wml/table-parser.js';
import { StandardParagraphParser } from '../../src/parser/wml/paragraph-parser.js';
import { StandardNumberingResolver } from '../../src/parser/wml/numbering-resolver.js';
import { parseParagraphProperties } from '../../src/parser/wml/style-resolver.js';

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

  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const headingStyles = `
<w:styles ${W}>
  <w:docDefaults>
    <w:rPrDefault><w:rPr><w:rFonts w:asciiTheme="minorHAnsi" w:hAnsiTheme="minorHAnsi"/><w:sz w:val="22"/></w:rPr></w:rPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:pPr><w:spacing w:after="160"/></w:pPr>
    <w:rPr><w:color w:val="333333"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr><w:spacing w:before="240"/></w:pPr>
    <w:rPr><w:rFonts w:asciiTheme="majorHAnsi" w:hAnsiTheme="majorHAnsi"/><w:b/><w:sz w:val="32"/><w:color w:val="2F5496"/></w:rPr>
  </w:style>
  <w:style w:type="character" w:styleId="Emphasis">
    <w:name w:val="Emphasis"/>
    <w:rPr><w:i/><w:sz w:val="20"/></w:rPr>
  </w:style>
</w:styles>`;
  const theme = `
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office">
  <a:themeElements>
    <a:fontScheme name="Office">
      <a:majorFont><a:latin typeface="Aptos Display"/><a:ea typeface=""/><a:cs typeface="Arial"/></a:majorFont>
      <a:minorFont><a:latin typeface="Aptos"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont>
    </a:fontScheme>
  </a:themeElements>
</a:theme>`;
  const paragraph = (xml: string, resolver: StandardStyleResolver) =>
    new StandardParagraphParser().parseParagraph(defaultXmlAdapter.parse(`<w:p ${W}>${xml}</w:p>`), resolver);

  it('gives heading runs the paragraph style run properties beneath character style and direct formatting (§17.7.2)', () => {
    const resolver = new StandardStyleResolver();
    resolver.loadStyles(defaultXmlAdapter.parse(headingStyles));
    const p = paragraph(
      `<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>` +
        `<w:r><w:t>Plain</w:t></w:r>` +
        `<w:r><w:rPr><w:rStyle w:val="Emphasis"/></w:rPr><w:t>Char</w:t></w:r>` +
        `<w:r><w:rPr><w:sz w:val="40"/><w:color w:val="FF0000"/></w:rPr><w:t>Direct</w:t></w:r>`,
      resolver,
    );
    const [plain, char, direct] = p.children;
    // Heading size, weight, and colour reach the text, not only the paragraph mark.
    expect(plain!.style).toMatchObject({ fontSizePt: 16, bold: true, color: '#2F5496' });
    expect(p.style?.markFontSizePt).toBe(16);
    // A character style sits above the paragraph style...
    expect(char!.style).toMatchObject({ fontSizePt: 10, italic: true, bold: true, color: '#2F5496' });
    // ...and direct formatting above both.
    expect(direct!.style).toMatchObject({ fontSizePt: 20, bold: true, color: '#FF0000' });
  });

  it('applies the default paragraph style to paragraphs that name none', () => {
    const resolver = new StandardStyleResolver();
    resolver.loadStyles(defaultXmlAdapter.parse(headingStyles));
    const p = paragraph(`<w:r><w:t>Body</w:t></w:r>`, resolver);
    expect(p.style?.spaceAfterPt).toBe(8);
    expect(p.children[0]!.style).toMatchObject({ fontSizePt: 11, color: '#333333' });
    expect(p.children[0]!.style?.bold).toBeUndefined();
    expect(resolver.resolveRunStyle().color).toBe('#333333');
  });

  it('resolves theme font references for headings (major) and body (minor), in either load order', () => {
    const themeFirst = new StandardStyleResolver();
    themeFirst.loadTheme(defaultXmlAdapter.parse(theme));
    themeFirst.loadStyles(defaultXmlAdapter.parse(headingStyles));
    const stylesFirst = new StandardStyleResolver();
    stylesFirst.loadStyles(defaultXmlAdapter.parse(headingStyles));
    stylesFirst.loadTheme(defaultXmlAdapter.parse(theme));
    for (const resolver of [themeFirst, stylesFirst]) {
      expect(resolver.resolveRunStyle('Heading1').fontFamily).toBe('Aptos Display');
      expect(resolver.resolveRunStyle('Normal').fontFamily).toBe('Aptos');
      expect(resolver.getDefaultRunStyle().fontFamily).toBe('Aptos');
      // Direct w:rFonts with a theme token resolves too; the theme attribute
      // outranks the literal one beside it, and bidi maps to the cs face.
      const p = paragraph(
        `<w:r><w:rPr><w:rFonts w:ascii="Courier New" w:asciiTheme="majorHAnsi"/></w:rPr><w:t>A</w:t></w:r>` +
          `<w:r><w:rPr><w:rFonts w:asciiTheme="majorBidi"/></w:rPr><w:t>B</w:t></w:r>` +
          `<w:r><w:rPr><w:rFonts w:asciiTheme="minorEastAsia"/></w:rPr><w:t>C</w:t></w:r>`,
        resolver,
      );
      expect(p.children[0]!.style?.fontFamily).toBe('Aptos Display');
      expect(p.children[1]!.style?.fontFamily).toBe('Arial');
      // Empty ea typeface falls back to the minor Latin face.
      expect(p.children[2]!.style?.fontFamily).toBe('Aptos');
    }
  });

  it('falls back to the literal font when no theme is loaded', () => {
    const resolver = new StandardStyleResolver();
    resolver.loadStyles(
      defaultXmlAdapter.parse(
        `<w:styles ${W}><w:style w:type="paragraph" w:styleId="H"><w:rPr><w:rFonts w:ascii="Georgia" w:asciiTheme="majorHAnsi"/></w:rPr></w:style>` +
          `<w:style w:type="paragraph" w:styleId="T"><w:rPr><w:rFonts w:asciiTheme="majorHAnsi"/></w:rPr></w:style></w:styles>`,
      ),
    );
    expect(resolver.resolveRunStyle('H').fontFamily).toBe('Georgia');
    // No literal and no theme: the token is never used as a font name.
    expect(resolver.resolveRunStyle('T').fontFamily).toBe('Calibri');
  });

  it('reads every w:ind spelling and lets w:hanging outrank w:firstLine', () => {
    const ind = (attrs: string) => parseParagraphProperties(defaultXmlAdapter.parse(`<w:pPr ${W}><w:ind ${attrs}/></w:pPr>`));
    expect(ind('w:left="720" w:firstLine="360"')).toEqual({ indentLeftPt: 36, firstLineIndentPt: 18 });
    expect(ind('w:start="720" w:end="360" w:hanging="360"')).toEqual({ indentLeftPt: 36, indentRightPt: 18, firstLineIndentPt: -18 });
    expect(ind('w:left="720" w:hanging="360" w:firstLine="100"').firstLineIndentPt).toBe(-18);
  });

  it('keeps the w:spacing line rule and the auto multiple', () => {
    const spacing = (attrs: string) => parseParagraphProperties(defaultXmlAdapter.parse(`<w:pPr ${W}><w:spacing ${attrs}/></w:pPr>`));
    expect(spacing('w:line="360" w:lineRule="atLeast"')).toEqual({ lineSpacingRule: 'atLeast', lineSpacingPt: 18 });
    expect(spacing('w:line="240" w:lineRule="exact"')).toEqual({ lineSpacingRule: 'exact', lineSpacingPt: 12 });
    expect(spacing('w:line="200" w:lineRule="atMost"')).toEqual({ lineSpacingRule: 'atMost', lineSpacingPt: 10 });
    const auto = spacing('w:line="360" w:lineRule="auto"');
    expect(auto.lineSpacingRule).toBe('auto');
    expect(auto.lineSpacingMultiple).toBeCloseTo(1.5, 10);
    expect(auto.lineSpacingPt).toBeCloseTo(19.8, 10);
    expect(spacing('w:line="480"').lineSpacingMultiple).toBe(2);
  });

  it('reads w:contextualSpacing as ST_OnOff', () => {
    const ppr = (xml: string) => parseParagraphProperties(defaultXmlAdapter.parse(`<w:pPr ${W}>${xml}</w:pPr>`));
    expect(ppr('<w:contextualSpacing/>').contextualSpacing).toBe(true);
    expect(ppr('<w:contextualSpacing w:val="0"/>').contextualSpacing).toBe(false);
  });

  it('orders indents as style, then numbering level, then direct formatting (§17.3.1.12)', () => {
    const resolver = new StandardStyleResolver();
    resolver.loadStyles(
      defaultXmlAdapter.parse(
        `<w:styles ${W}><w:style w:type="paragraph" w:styleId="ListParagraph"><w:pPr><w:ind w:left="1440"/></w:pPr></w:style></w:styles>`,
      ),
    );
    const numbering = new StandardNumberingResolver();
    numbering.parseNumberingXml(
      `<w:numbering ${W}><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/>` +
        `<w:pPr><w:ind w:start="720" w:hanging="360"/></w:pPr></w:lvl>` +
        `<w:lvl w:ilvl="1"><w:numFmt w:val="decimal"/><w:lvlText w:val="%2."/><w:pPr><w:ind w:left="1080" w:firstLine="200"/></w:pPr></w:lvl>` +
        `</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num></w:numbering>`,
    );
    const parse = (ppr: string) =>
      new StandardParagraphParser().parseParagraph(
        defaultXmlAdapter.parse(`<w:p ${W}><w:pPr><w:pStyle w:val="ListParagraph"/>${ppr}</w:pPr><w:r><w:t>x</w:t></w:r></w:p>`),
        resolver,
        numbering,
      );
    // The level's indents beat the style's 1440.
    const level = parse('<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>');
    expect(level.styleId).toBe('ListParagraph');
    expect(level.style).toMatchObject({ indentLeftPt: 36, firstLineIndentPt: -18 });
    // A positive first-line indent on the level is honoured too.
    const second = parse('<w:numPr><w:ilvl w:val="1"/><w:numId w:val="1"/></w:numPr>');
    expect(second.style).toMatchObject({ indentLeftPt: 54, firstLineIndentPt: 10 });
    // Direct w:ind beats the level.
    const direct = parse('<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr><w:ind w:left="2000" w:hanging="100"/>');
    expect(direct.style).toMatchObject({ indentLeftPt: 100, firstLineIndentPt: -5 });
  });
});
