import { describe, expect, it } from 'bun:test';
import { StandardDocumentParser } from '../../src/parser/wml/document-parser.js';

describe('Multi-Column Section (w:cols) Parser', () => {
  it('should parse w:cols with count, space, and separator', () => {
    const xml = `
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Multi column text</w:t></w:r></w:p>
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>
      <w:cols w:num="2" w:space="720" w:sep="1"/>
    </w:sectPr>
  </w:body>
</w:document>`;

    const parser = new StandardDocumentParser();
    const doc = parser.parseDocumentXml(xml);

    expect(doc.sections.length).toBe(1);
    const section = doc.sections[0]!;
    expect(section.properties.columns).toBeDefined();
    expect(section.properties.columns?.count).toBe(2);
    expect(section.properties.columns?.spacePt).toBe(36); // 720 twips = 36 pt
    expect(section.properties.columns?.separator).toBe(true);
    expect(section.properties.columns?.equalWidth).toBe(true);
  });

  it('should parse explicit column definitions when present', () => {
    const xml = `
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Custom columns</w:t></w:r></w:p>
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>
      <w:cols w:num="2" w:equalWidth="0">
        <w:col w:w="4000" w:space="1000"/>
        <w:col w:w="4360"/>
      </w:cols>
    </w:sectPr>
  </w:body>
</w:document>`;

    const parser = new StandardDocumentParser();
    const doc = parser.parseDocumentXml(xml);

    const columns = doc.sections[0]!.properties.columns;
    expect(columns).toBeDefined();
    expect(columns?.count).toBe(2);
    expect(columns?.equalWidth).toBe(false);
    expect(columns?.columns).toBeDefined();
    expect(columns?.columns?.length).toBe(2);
    expect(columns?.columns![0]!.widthPt).toBe(200); // 4000 twips = 200 pt
    expect(columns?.columns![0]!.spacePt).toBe(50); // 1000 twips = 50 pt
    expect(columns?.columns![1]!.widthPt).toBe(218); // 4360 twips = 218 pt
  });
});
