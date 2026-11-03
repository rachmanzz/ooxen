import { describe, expect, it } from 'bun:test';
import { openPackage } from '../../src/opc/package.js';
import { KNOWN_RELATIONSHIPS } from '../../src/opc/relationships.js';
import { StandardDocumentParser } from '../../src/parser/wml/document-parser.js';
import { MapHeaderFooterResolver, parseHeaderFooterXml } from '../../src/parser/wml/header-footer-parser.js';
import { exportOoxmlFromHtml, StandardOoxenWriter } from '../../src/serializer/ooxen-writer.js';
import type { DocumentNode } from '../../src/types/ast.js';

describe('Header & Footer Serializer & Bidirectional Round-Trip', () => {
  const decoder = new TextDecoder();

  it('should serialize header and footer parts and reference them in document.xml', async () => {
    const doc: DocumentNode = {
      type: 'document',
      sections: [
        {
          type: 'section',
          properties: {
            pageSize: { width: 612, height: 792 },
            margins: { top: 72, right: 72, bottom: 72, left: 72 },
            headerDistancePt: 36,
            footerDistancePt: 36,
          },
          headers: {
            default: {
              type: 'header',
              kind: 'default',
              children: [
                {
                  type: 'paragraph',
                  children: [{ type: 'run', text: 'Document Running Header' }],
                },
              ],
            },
          },
          footers: {
            default: {
              type: 'footer',
              kind: 'default',
              children: [
                {
                  type: 'paragraph',
                  children: [
                    { type: 'run', text: 'Page ' },
                    { type: 'run', text: '1', field: 'PAGE' },
                  ],
                },
              ],
            },
          },
          children: [
            {
              type: 'paragraph',
              children: [{ type: 'run', text: 'Hello Header Footer' }],
            },
          ],
        },
      ],
    };

    const writer = new StandardOoxenWriter();
    const docxBytes = await writer.write(doc);
    expect(docxBytes.byteLength).toBeGreaterThan(0);

    // Unpack ZIP package and inspect parts
    const pkg = await openPackage(docxBytes);

    // Verify header part exists
    const headerPart = pkg.getPart('word/header1.xml');
    expect(headerPart).toBeDefined();
    const headerXml = decoder.decode(headerPart?.data);
    expect(headerXml).toContain('<w:hdr');
    expect(headerXml).toContain('Document Running Header');

    // Verify footer part exists
    const footerPart = pkg.getPart('word/footer1.xml');
    expect(footerPart).toBeDefined();
    const footerXml = decoder.decode(footerPart?.data);
    expect(footerXml).toContain('<w:ftr');
    expect(footerXml).toContain('w:fldSimple w:instr="PAGE"');

    // Verify document.xml relationships
    const rels = pkg.getRelationships('word/document.xml');
    const headerRel = rels.find((r) => r.type === KNOWN_RELATIONSHIPS.HEADER);
    expect(headerRel).toBeDefined();
    expect(headerRel?.target).toBe('header1.xml');

    const footerRel = rels.find((r) => r.type === KNOWN_RELATIONSHIPS.FOOTER);
    expect(footerRel).toBeDefined();
    expect(footerRel?.target).toBe('footer1.xml');

    // Verify document.xml contains headerReference & footerReference
    const docPart = pkg.getPart('word/document.xml');
    expect(docPart).toBeDefined();
    const docXml = decoder.decode(docPart?.data);
    expect(docXml).toContain('<w:headerReference w:type="default"');
    expect(docXml).toContain('<w:footerReference w:type="default"');

    // Parse back using StandardDocumentParser and MapHeaderFooterResolver
    const resolver = new MapHeaderFooterResolver();
    resolver.registerHeader('rIdHdr1', parseHeaderFooterXml(headerXml, 'default'));
    resolver.registerFooter('rIdFtr1', parseHeaderFooterXml(footerXml, 'default'));

    const parser = new StandardDocumentParser();
    const parsedDoc = parser.parseDocumentXml(docXml, undefined, undefined, undefined, resolver);

    expect(parsedDoc.sections.length).toBe(1);
    const parsedSection = parsedDoc.sections[0]!;
    expect(parsedSection.headers?.default).toBeDefined();
    expect(parsedSection.headers?.default?.children[0]?.type).toBe('paragraph');
    expect(parsedSection.footers?.default).toBeDefined();
    expect(parsedSection.footers?.default?.children[0]?.type).toBe('paragraph');
  });

  it('should round-trip HTML containing header and footer elements to OOXML', async () => {
    const html = `
<article class="ooxen-document" xmlns="http://www.w3.org/1999/xhtml">
  <section class="ooxen-section" style="width: 612pt; min-height: 792pt; padding: 72pt 72pt 72pt 72pt;">
    <header class="ooxen-header">
      <p class="ooxen-p"><span class="ooxen-r" style="font-weight: bold;">HTML Header Section</span></p>
    </header>
    <p class="ooxen-p"><span class="ooxen-r">Main Article Body</span></p>
    <footer class="ooxen-footer">
      <p class="ooxen-p"><span class="ooxen-r">Page </span><span class="ooxen-r ooxen-field-page">1</span></p>
    </footer>
  </section>
</article>`;

    const docxBytes = await exportOoxmlFromHtml(html);
    expect(docxBytes.byteLength).toBeGreaterThan(0);

    const pkg = await openPackage(docxBytes);
    const headerPart = pkg.getPart('word/header1.xml');
    expect(headerPart).toBeDefined();
    expect(decoder.decode(headerPart?.data)).toContain('HTML Header Section');

    const footerPart = pkg.getPart('word/footer1.xml');
    expect(footerPart).toBeDefined();
    const ftrXml = decoder.decode(footerPart?.data);
    expect(ftrXml).toContain('w:fldSimple w:instr="PAGE"');
  });
});
