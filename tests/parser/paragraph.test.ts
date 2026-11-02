import { describe, expect, it } from 'bun:test';
import { defaultXmlAdapter } from '../../src/parser/xml-adapter.js';
import { StandardParagraphParser } from '../../src/parser/wml/paragraph-parser.js';

describe('OOXML Paragraph Parser', () => {
  it('should parse paragraph with formatting and text runs correctly', () => {
    const xml = `
<w:p xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:pPr>
    <w:jc w:val="both"/>
    <w:spacing w:before="120" w:after="240"/>
  </w:pPr>
  <w:r>
    <w:rPr>
      <w:b/>
      <w:color w:val="FF0000"/>
      <w:sz w:val="28"/>
    </w:rPr>
    <w:t>Hello </w:t>
  </w:r>
  <w:r>
    <w:rPr>
      <w:i/>
      <w:u w:val="single"/>
    </w:rPr>
    <w:t>World</w:t>
  </w:r>
</w:p>`;

    const node = defaultXmlAdapter.parse(xml);
    const parser = new StandardParagraphParser();
    const paragraph = parser.parseParagraph(node);

    expect(paragraph.type).toBe('paragraph');
    expect(paragraph.style?.alignment).toBe('justify');
    expect(paragraph.style?.spaceBeforePt).toBe(6); // 120 / 20
    expect(paragraph.style?.spaceAfterPt).toBe(12); // 240 / 20

    expect(paragraph.children.length).toBe(2);

    const run1 = paragraph.children[0];
    expect(run1?.text).toBe('Hello ');
    expect(run1?.style?.bold).toBe(true);
    expect(run1?.style?.color).toBe('#FF0000');
    expect(run1?.style?.fontSizePt).toBe(14); // 28 / 2

    const run2 = paragraph.children[1];
    expect(run2?.text).toBe('World');
    expect(run2?.style?.italic).toBe(true);
    expect(run2?.style?.underline).toBe(true);
  });
});
