import { describe, expect, it } from 'bun:test';
import { defaultXmlAdapter } from '../../src/parser/xml-adapter.js';
import { StandardDocumentParser } from '../../src/parser/wml/document-parser.js';

describe('OOXML Document Parser', () => {
  it('should parse complete document with body, paragraphs, and section dimensions', () => {
    const xml = `
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:r><w:t>Paragraph in first section</w:t></w:r>
    </w:p>
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>
    </w:sectPr>
  </w:body>
</w:document>`;

    const node = defaultXmlAdapter.parse(xml);
    const parser = new StandardDocumentParser();
    const doc = parser.parseDocument(node);

    expect(doc.type).toBe('document');
    expect(doc.sections.length).toBe(1);

    const section = doc.sections[0];
    expect(section).toBeDefined();

    // A4 dimensions: 11906 twips / 20 = 595.3 pt, 16838 twips / 20 = 841.9 pt
    expect(section?.properties.pageSize.width).toBeCloseTo(595.3, 1);
    expect(section?.properties.pageSize.height).toBeCloseTo(841.9, 1);

    // Margins: 1440 twips / 20 = 72 pt (1 inch)
    expect(section?.properties.margins.top).toBe(72);
    expect(section?.properties.margins.right).toBe(72);
    expect(section?.properties.margins.bottom).toBe(72);
    expect(section?.properties.margins.left).toBe(72);

    expect(section?.children.length).toBe(1);
    const p = section?.children[0];
    expect(p?.type).toBe('paragraph');
  });
});
