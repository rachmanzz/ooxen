import { describe, expect, it } from 'bun:test';
import { defaultParagraphParser } from '../../src/parser/wml/paragraph-parser.js';
import { defaultXmlAdapter } from '../../src/parser/xml-adapter.js';

describe('ISO/IEC 29500 Revision Tracking Parser (w:ins & w:del)', () => {
  it('should parse inserted runs from w:ins with metadata', () => {
    const xml = `<w:p xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:r><w:t>Base text </w:t></w:r>
  <w:ins w:id="101" w:author="Carol editor" w:date="2026-11-02T16:00:00Z">
    <w:r><w:t>inserted revision</w:t></w:r>
  </w:ins>
  <w:r><w:t> end.</w:t></w:r>
</w:p>`;

    const pNode = defaultXmlAdapter.parse(xml);
    const paragraph = defaultParagraphParser.parseParagraph(pNode);

    expect(paragraph.children.length).toBe(3);

    const insRun = paragraph.children[1]!;
    expect(insRun.text).toBe('inserted revision');
    expect(insRun.revision).toBeDefined();
    expect(insRun.revision?.type).toBe('insert');
    expect(insRun.revision?.id).toBe('101');
    expect(insRun.revision?.author).toBe('Carol editor');
    expect(insRun.revision?.date).toBe('2026-11-02T16:00:00Z');
  });

  it('should parse deleted runs from w:del with delText', () => {
    const xml = `<w:p xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:r><w:t>Original text </w:t></w:r>
  <w:del w:id="102" w:author="Dave reviewer" w:date="2026-11-02T17:00:00Z">
    <w:r><w:delText>deleted content</w:delText></w:r>
  </w:del>
</w:p>`;

    const pNode = defaultXmlAdapter.parse(xml);
    const paragraph = defaultParagraphParser.parseParagraph(pNode);

    expect(paragraph.children.length).toBe(2);

    const delRun = paragraph.children[1]!;
    expect(delRun.text).toBe('deleted content');
    expect(delRun.revision).toBeDefined();
    expect(delRun.revision?.type).toBe('delete');
    expect(delRun.revision?.id).toBe('102');
    expect(delRun.revision?.author).toBe('Dave reviewer');
    expect(delRun.revision?.date).toBe('2026-11-02T17:00:00Z');
  });
});
