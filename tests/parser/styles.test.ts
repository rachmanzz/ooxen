import { describe, expect, it } from 'bun:test';
import { defaultXmlAdapter } from '../../src/parser/xml-adapter.js';
import { StandardStyleResolver } from '../../src/parser/wml/style-resolver.js';

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
    expect(headingP.lineSpacingPt).toBe(12); // 240 / 20 inherited

    // Heading 1 run style
    const headingR = resolver.resolveRunStyle('Heading1');
    expect(headingR.fontFamily).toBe('Arial');
    expect(headingR.bold).toBe(true);
    expect(headingR.fontSizePt).toBe(16); // 32 / 2
    expect(headingR.color).toBe('#2E74B5');
  });
});
