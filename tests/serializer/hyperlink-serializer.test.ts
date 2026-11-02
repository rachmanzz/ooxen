import { describe, expect, it } from 'bun:test';
import { openPackage } from '../../src/opc/package.js';
import { KNOWN_RELATIONSHIPS } from '../../src/opc/relationships.js';
import { StandardDocumentParser } from '../../src/parser/wml/document-parser.js';
import { MapHyperlinkResolver } from '../../src/parser/wml/paragraph-parser.js';
import { exportOoxml, exportOoxmlFromHtml, StandardOoxenWriter } from '../../src/serializer/ooxen-writer.js';
import type { DocumentNode } from '../../src/types/ast.js';

describe('Hyperlink & Bookmark Serializer & Round-Trip', () => {
  const decoder = new TextDecoder();

  it('should serialize external and internal hyperlinks into docx package with external relationships', async () => {
    const doc: DocumentNode = {
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
              bookmarkName: 'bm_top',
              children: [
                {
                  type: 'run',
                  text: 'Check ',
                },
                {
                  type: 'run',
                  text: 'Ooxen Project',
                  hyperlink: { url: 'https://github.com/rachmanzz/ooxen', tooltip: 'GitHub' },
                },
                {
                  type: 'run',
                  text: ' or ',
                },
                {
                  type: 'run',
                  text: 'Return to Top',
                  hyperlink: { anchor: 'bm_top' },
                },
              ],
            },
          ],
        },
      ],
    };

    const writer = new StandardOoxenWriter();
    const docxBytes = await writer.write(doc);
    expect(docxBytes.byteLength).toBeGreaterThan(0);

    const pkg = await openPackage(docxBytes);

    // 1. Check external relationship on word/document.xml
    const rels = pkg.getRelationships('word/document.xml');
    const linkRel = rels.find((r) => r.type === KNOWN_RELATIONSHIPS.HYPERLINK);
    expect(linkRel).toBeDefined();
    expect(linkRel?.target).toBe('https://github.com/rachmanzz/ooxen');
    expect(linkRel?.targetMode).toBe('External');

    // 2. Check XML in word/document.xml
    const docPart = pkg.getPart('word/document.xml');
    expect(docPart).toBeDefined();
    const docXml = decoder.decode(docPart?.data);

    expect(docXml).toContain('<w:bookmarkStart');
    expect(docXml).toContain('w:name="bm_top"');
    expect(docXml).toContain('<w:bookmarkEnd');
    expect(docXml).toContain(`<w:hyperlink r:id="${linkRel?.id}"`);
    expect(docXml).toContain('w:tooltip="GitHub"');
    expect(docXml).toContain('<w:hyperlink w:anchor="bm_top"');

    // 3. Parse back with StandardDocumentParser
    const hyperlinkResolver = new MapHyperlinkResolver();
    hyperlinkResolver.register(linkRel!.id, linkRel!.target);

    const parser = new StandardDocumentParser();
    const parsedDoc = parser.parseDocumentXml(docXml, undefined, undefined, undefined, undefined, hyperlinkResolver);

    expect(parsedDoc.sections.length).toBe(1);
    const parsedP = parsedDoc.sections[0]!.children[0];
    expect(parsedP?.type).toBe('paragraph');

    if (parsedP?.type === 'paragraph') {
      expect(parsedP.bookmarkName).toBe('bm_top');
      const extRun = parsedP.children.find((r) => r.text === 'Ooxen Project');
      expect(extRun).toBeDefined();
      expect(extRun?.hyperlink?.url).toBe('https://github.com/rachmanzz/ooxen');
      expect(extRun?.hyperlink?.tooltip).toBe('GitHub');

      const anchorRun = parsedP.children.find((r) => r.text === 'Return to Top');
      expect(anchorRun).toBeDefined();
      expect(anchorRun?.hyperlink?.anchor).toBe('bm_top');
    }
  });

  it('should round-trip HTML containing <a> hyperlinks and anchor tags to OOXML', async () => {
    const html = `
<article class="ooxen-document" xmlns="http://www.w3.org/1999/xhtml">
  <section class="ooxen-section" style="width: 612pt; min-height: 792pt; padding: 72pt;">
    <p class="ooxen-p" id="chapter1">
      <span class="ooxen-r">Read </span>
      <a class="ooxen-link" href="https://iso.org" title="ISO Standards"><span class="ooxen-r">ISO 29500</span></a>
      <span class="ooxen-r"> or </span>
      <a class="ooxen-link" href="#chapter1"><span class="ooxen-r">Reload Chapter 1</span></a>
    </p>
  </section>
</article>`;

    const docxBytes = await exportOoxmlFromHtml(html);
    expect(docxBytes.byteLength).toBeGreaterThan(0);

    const pkg = await openPackage(docxBytes);
    const rels = pkg.getRelationships('word/document.xml');
    const linkRel = rels.find((r) => r.type === KNOWN_RELATIONSHIPS.HYPERLINK);
    expect(linkRel).toBeDefined();
    expect(linkRel?.target).toBe('https://iso.org');

    const docPart = pkg.getPart('word/document.xml');
    expect(docPart).toBeDefined();
    const docXml = decoder.decode(docPart?.data);

    expect(docXml).toContain('w:name="chapter1"');
    expect(docXml).toContain(`r:id="${linkRel?.id}"`);
    expect(docXml).toContain('w:anchor="chapter1"');
  });
});
