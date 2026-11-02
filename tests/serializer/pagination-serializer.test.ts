import { describe, expect, it } from 'bun:test';
import { defaultParagraphParser } from '../../src/parser/wml/paragraph-parser.js';
import { StandardStyleResolver } from '../../src/parser/wml/style-resolver.js';
import { defaultXmlAdapter } from '../../src/parser/xml-adapter.js';
import { defaultHtmlRenderer } from '../../src/renderer/html/html-renderer.js';
import { defaultStyleMapper } from '../../src/renderer/html/style-mapper.js';
import { exportOoxmlFromHtml } from '../../src/serializer/ooxen-writer.js';
import { defaultWmlBuilder } from '../../src/serializer/wml-builder.js';
import type { DocumentNode, ParagraphNode } from '../../src/types/ast.js';
import { openDocument } from '../../src/parser/wml/document-parser.js';

describe('ISO/IEC 29500 Pagination Controls Serializer & Round-Trip', () => {
  const styleResolver = new StandardStyleResolver();

  describe('WML Builder serialization', () => {
    it('should serialize pageBreakBefore, keepNext, and keepLines in w:pPr', () => {
      const paragraph: ParagraphNode = {
        type: 'paragraph',
        style: {
          pageBreakBefore: true,
          keepNext: true,
          keepLines: true,
        },
        children: [{ type: 'run', text: 'Section Heading' }],
      };

      const xml = defaultWmlBuilder.buildParagraphXml(paragraph);

      expect(xml).toContain('<w:pageBreakBefore/>');
      expect(xml).toContain('<w:keepNext/>');
      expect(xml).toContain('<w:keepLines/>');
      expect(xml).toContain('Section Heading');
    });

    it('should serialize explicit w:br w:type="page" and "column" in w:r', () => {
      const paragraph: ParagraphNode = {
        type: 'paragraph',
        children: [
          { type: 'run', text: 'Before page break' },
          { type: 'run', text: '', breakType: 'page' },
          { type: 'run', text: 'Before column break' },
          { type: 'run', text: '', breakType: 'column' },
          { type: 'run', text: 'End' },
        ],
      };

      const xml = defaultWmlBuilder.buildParagraphXml(paragraph);

      expect(xml).toContain('<w:br w:type="page"/>');
      expect(xml).toContain('<w:br w:type="column"/>');
      expect(xml).toContain('Before page break');
      expect(xml).toContain('Before column break');
    });
  });

  describe('WML Parser parsing', () => {
    it('should parse pageBreakBefore, keepNext, and keepLines from w:pPr', () => {
      const xml = `<w:p xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:pPr>
    <w:pageBreakBefore w:val="true"/>
    <w:keepNext/>
    <w:keepLines w:val="1"/>
  </w:pPr>
  <w:r><w:t>Heading content</w:t></w:r>
</w:p>`;

      const pNode = defaultXmlAdapter.parse(xml);
      const paragraph = defaultParagraphParser.parseParagraph(pNode, styleResolver);

      expect(paragraph.style?.pageBreakBefore).toBe(true);
      expect(paragraph.style?.keepNext).toBe(true);
      expect(paragraph.style?.keepLines).toBe(true);
    });

    it('should parse w:br w:type="page" and "column" into run.breakType', () => {
      const xml = `<w:p xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:r><w:t>First page</w:t></w:r>
  <w:r><w:br w:type="page"/></w:r>
  <w:r><w:t>Second page</w:t></w:r>
  <w:r><w:br w:type="column"/></w:r>
  <w:r><w:t>Second col</w:t></w:r>
</w:p>`;

      const pNode = defaultXmlAdapter.parse(xml);
      const paragraph = defaultParagraphParser.parseParagraph(pNode, styleResolver);

      expect(paragraph.children.length).toBe(5);
      expect(paragraph.children[1]?.breakType).toBe('page');
      expect(paragraph.children[3]?.breakType).toBe('column');
    });
  });

  describe('HTML Style Mapper & Renderer', () => {
    it('should map pageBreakBefore, keepNext, and keepLines to CSS declarations', () => {
      const css = defaultStyleMapper.paragraphStyleToCss({
        pageBreakBefore: true,
        keepNext: true,
        keepLines: true,
      });

      expect(css['break-before']).toBe('page');
      expect(css['page-break-before']).toBe('always');
      expect(css['break-after']).toBe('avoid');
      expect(css['break-inside']).toBe('avoid');
    });

    it('should render page break and column break spans in HTML', () => {
      const doc: DocumentNode = {
        type: 'document',
        sections: [
          {
            type: 'section',
            properties: { pageSize: { width: 612, height: 792 }, margins: { top: 72, right: 72, bottom: 72, left: 72 } },
            children: [
              {
                type: 'paragraph',
                children: [
                  { type: 'run', text: 'Part 1' },
                  { type: 'run', text: '', breakType: 'page' },
                  { type: 'run', text: 'Part 2' },
                ],
              },
            ],
          },
        ],
      };

      const html = defaultHtmlRenderer.renderToHtmlString(doc);
      expect(html).toContain('ooxen-page-break');
    });
  });

  describe('Bidirectional Round-Trip: HTML -> DOCX -> DocumentNode', () => {
    it('should preserve pageBreakBefore and explicit breaks across round-trip', async () => {
      const htmlInput = `<article class="ooxen-document">
  <section class="ooxen-section">
    <p class="ooxen-p" style="page-break-before: always; break-after: avoid; break-inside: avoid;">
      <span class="ooxen-r">Chapter 2 Heading</span>
    </p>
    <p class="ooxen-p">
      <span class="ooxen-r">Intro</span>
      <span class="ooxen-page-break" style="break-before: page; page-break-before: always;"></span>
      <span class="ooxen-r">Followup</span>
    </p>
  </section>
</article>`;

      const docxBytes = await exportOoxmlFromHtml(htmlInput);
      const reloadedDoc = await openDocument(docxBytes);

      const p1 = reloadedDoc.sections[0]?.children[0];
      expect(p1?.type).toBe('paragraph');
      if (p1?.type === 'paragraph') {
        expect(p1.style?.pageBreakBefore).toBe(true);
        expect(p1.style?.keepNext).toBe(true);
        expect(p1.style?.keepLines).toBe(true);
      }

      const p2 = reloadedDoc.sections[0]?.children[1];
      expect(p2?.type).toBe('paragraph');
      if (p2?.type === 'paragraph') {
        const pageBreakRun = p2.children.find((r) => r.breakType === 'page');
        expect(pageBreakRun).toBeDefined();
      }
    });
  });
});
