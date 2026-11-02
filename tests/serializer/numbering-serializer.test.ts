import { describe, expect, it } from 'bun:test';
import type { DocumentNode } from '../../src/types/ast.js';
import { StandardHtmlRenderer } from '../../src/renderer/html/html-renderer.js';
import { StandardWmlBuilder } from '../../src/serializer/wml-builder.js';
import { StandardOoxenWriter } from '../../src/serializer/ooxen-writer.js';
import { openPackage } from '../../src/opc/package.js';
import { StandardDocumentParser } from '../../src/parser/wml/document-parser.js';
import { StandardNumberingResolver } from '../../src/parser/wml/numbering-resolver.js';

describe('Numbering Serializer & Bidirectional HTML List Round-Trip', () => {
  const sampleListDoc: DocumentNode = {
    type: 'document',
    sections: [
      {
        type: 'section',
        properties: {
          pageSize: { width: 612, height: 792 },
          margins: { top: 72, right: 72, bottom: 72, left: 72 },
        },
        children: [
          {
            type: 'paragraph',
            style: {
              numbering: {
                numId: 2,
                level: 0,
                format: 'decimal',
                prefixText: '1.',
              },
            },
            children: [{ type: 'run', text: 'First ordered item' }],
          },
          {
            type: 'paragraph',
            style: {
              numbering: {
                numId: 2,
                level: 0,
                format: 'decimal',
                prefixText: '2.',
              },
            },
            children: [{ type: 'run', text: 'Second ordered item' }],
          },
        ],
      },
    ],
  };

  it('should serialize paragraph numbering properties in WordprocessingML', () => {
    const builder = new StandardWmlBuilder();
    const xml = builder.buildDocumentXml(sampleListDoc);

    expect(xml).toContain('<w:numPr>');
    expect(xml).toContain('<w:ilvl w:val="0"/>');
    expect(xml).toContain('<w:numId w:val="2"/>');
  });

  it('should render HTML with bullet / numbering prefix span', () => {
    const htmlRenderer = new StandardHtmlRenderer();
    const html = htmlRenderer.renderToHtmlString(sampleListDoc);

    expect(html).toContain('<span class="ooxen-bullet" style="display: inline-block; min-width: 1.5em;">1. </span>');
    expect(html).toContain('First ordered item');
    expect(html).toContain('<span class="ooxen-bullet" style="display: inline-block; min-width: 1.5em;">2. </span>');
  });

  it('should round-trip HTML lists (ol/ul) to DOCX with numbering.xml and re-parse to AST', async () => {
    const writer = new StandardOoxenWriter();
    const xhtml = `
      <article class="ooxen-document" xmlns="http://www.w3.org/1999/xhtml">
        <section class="ooxen-section" style="width: 612pt; min-height: 792pt; padding: 72pt;">
          <p class="ooxen-p"><span class="ooxen-r">Title</span></p>
          <ol>
            <li><span class="ooxen-r">Alpha Step</span></li>
            <li><span class="ooxen-r">Beta Step</span></li>
          </ol>
          <ul>
            <li><span class="ooxen-r">Bullet One</span></li>
          </ul>
        </section>
      </article>
    `;

    const docxBytes = await writer.writeFromHtml(xhtml);
    expect(docxBytes.byteLength).toBeGreaterThan(100);

    const opc = await openPackage(docxBytes);

    // Verify word/numbering.xml part exists
    const numberingPart = opc.getPart('/word/numbering.xml');
    expect(numberingPart).toBeDefined();
    const numberingXmlStr = new TextDecoder().decode(numberingPart!.data);
    expect(numberingXmlStr).toContain('<w:numbering');
    expect(numberingXmlStr).toContain('w:abstractNumId="1"');
    expect(numberingXmlStr).toContain('w:abstractNumId="2"');

    // Verify document.xml has numPr
    const docPart = opc.getPart('/word/document.xml');
    expect(docPart).toBeDefined();
    const docXmlStr = new TextDecoder().decode(docPart!.data);
    expect(docXmlStr).toContain('<w:numPr>');
    expect(docXmlStr).toContain('<w:numId w:val="2"/>'); // ol
    expect(docXmlStr).toContain('<w:numId w:val="1"/>'); // ul

    // Re-parse with NumberingResolver
    const resolver = new StandardNumberingResolver();
    resolver.parseNumberingXml(numberingXmlStr);

    const docParser = new StandardDocumentParser();
    const reParsedDoc = docParser.parseDocumentXml(docXmlStr, undefined, resolver);

    const section = reParsedDoc.sections[0]!;
    expect(section.children.length).toBe(4); // title + 2 ol items + 1 ul item

    const item1 = section.children[1]!;
    const item2 = section.children[2]!;
    const item3 = section.children[3]!;

    if (item1.type === 'paragraph' && item2.type === 'paragraph' && item3.type === 'paragraph') {
      expect(item1.style?.numbering?.prefixText).toBe('1.');
      expect(item2.style?.numbering?.prefixText).toBe('2.');
      expect(item3.style?.numbering?.prefixText).toBe('•');
    }
  });
});
