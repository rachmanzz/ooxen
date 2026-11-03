import { describe, expect, it } from 'bun:test';
import { StandardDocumentParser } from '../../src/parser/wml/document-parser.js';
import { MapHeaderFooterResolver, parseHeaderFooterXml } from '../../src/parser/wml/header-footer-parser.js';

describe('Header & Footer Parser', () => {
  it('should parse w:hdr and w:ftr XML into HeaderFooterNode with paragraphs and runs', () => {
    const hdrXml = `
      <w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:p>
          <w:pPr><w:jc w:val="right"/></w:pPr>
          <w:r><w:t>Confidential Report</w:t></w:r>
        </w:p>
      </w:hdr>
    `;

    const ftrXml = `
      <w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:p>
          <w:pPr><w:jc w:val="center"/></w:pPr>
          <w:r><w:t>Page </w:t></w:r>
          <w:fldSimple w:instr="PAGE">
            <w:r><w:t>1</w:t></w:r>
          </w:fldSimple>
          <w:r><w:t> of </w:t></w:r>
          <w:fldSimple w:instr="NUMPAGES">
            <w:r><w:t>1</w:t></w:r>
          </w:fldSimple>
        </w:p>
      </w:ftr>
    `;

    const headerNode = parseHeaderFooterXml(hdrXml, 'default');
    expect(headerNode.type).toBe('header');
    expect(headerNode.kind).toBe('default');
    expect(headerNode.children.length).toBe(1);

    const hdrP = headerNode.children[0];
    expect(hdrP?.type).toBe('paragraph');
    if (hdrP?.type === 'paragraph') {
      expect(hdrP.style?.alignment).toBe('right');
      expect(hdrP.children[0]?.text).toBe('Confidential Report');
    }

    const footerNode = parseHeaderFooterXml(ftrXml, 'default');
    expect(footerNode.type).toBe('footer');
    expect(footerNode.kind).toBe('default');
    expect(footerNode.children.length).toBe(1);

    const ftrP = footerNode.children[0];
    expect(ftrP?.type).toBe('paragraph');
    if (ftrP?.type === 'paragraph') {
      expect(ftrP.style?.alignment).toBe('center');
      expect(ftrP.children.length).toBe(4);
      expect(ftrP.children[0]?.text).toBe('Page ');
      expect(ftrP.children[1]?.field).toBe('PAGE');
      expect(ftrP.children[2]?.text).toBe(' of ');
      expect(ftrP.children[3]?.field).toBe('NUMPAGES');
    }
  });

  it('should parse document section with headerReference and footerReference via resolver', () => {
    const hdrXml = `
      <w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:p><w:r><w:t>Document Header</w:t></w:r></w:p>
      </w:hdr>
    `;

    const ftrXml = `
      <w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:p><w:r><w:t>Document Footer</w:t></w:r></w:p>
      </w:ftr>
    `;

    const resolver = new MapHeaderFooterResolver();
    resolver.registerHeader('rIdHdr1', parseHeaderFooterXml(hdrXml, 'default'));
    resolver.registerFooter('rIdFtr1', parseHeaderFooterXml(ftrXml, 'default'));

    const docXml = `
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
        <w:body>
          <w:p><w:r><w:t>Body Text</w:t></w:r></w:p>
          <w:sectPr>
            <w:headerReference w:type="default" r:id="rIdHdr1"/>
            <w:footerReference w:type="default" r:id="rIdFtr1"/>
            <w:pgSz w:w="12240" w:h="15840"/>
            <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720"/>
            <w:titlePg/>
          </w:sectPr>
        </w:body>
      </w:document>
    `;

    const parser = new StandardDocumentParser();
    const doc = parser.parseDocumentXml(docXml, undefined, undefined, undefined, resolver);

    expect(doc.sections.length).toBe(1);
    const section = doc.sections[0]!;
    expect(section.properties.headerDistancePt).toBe(36); // 720 / 20 = 36 pt
    expect(section.properties.footerDistancePt).toBe(36); // 720 / 20 = 36 pt
    expect(section.properties.titlePg).toBe(true);

    expect(section.headers?.default).toBeDefined();
    expect(section.headers?.default?.children[0]?.type).toBe('paragraph');
    expect(section.footers?.default).toBeDefined();
    expect(section.footers?.default?.children[0]?.type).toBe('paragraph');
  });
});
