import { describe, expect, it } from 'bun:test';
import { StandardDocumentParser } from '../../src/parser/wml/document-parser.js';
import { MapHyperlinkResolver, StandardParagraphParser } from '../../src/parser/wml/paragraph-parser.js';
import { defaultXmlAdapter } from '../../src/parser/xml-adapter.js';

describe('Hyperlink & Bookmark Parser', () => {
  it('should parse external and internal hyperlinks and bookmarks inside paragraph', () => {
    const xml = `
      <w:p xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
        <w:bookmarkStart w:id="1" w:name="section_overview"/>
        <w:r><w:t>Overview: </w:t></w:r>
        <w:bookmarkEnd w:id="1"/>
        <w:hyperlink r:id="rIdWeb" w:tooltip="Visit Docs">
          <w:r><w:t>Online Documentation</w:t></w:r>
        </w:hyperlink>
        <w:r><w:t> and </w:t></w:r>
        <w:hyperlink w:anchor="section_appendix">
          <w:r><w:t>See Appendix</w:t></w:r>
        </w:hyperlink>
      </w:p>
    `;

    const resolver = new MapHyperlinkResolver();
    resolver.register('rIdWeb', 'https://ooxen.dev/docs');

    const node = defaultXmlAdapter.parse(xml);
    const parser = new StandardParagraphParser();
    const paragraph = parser.parseParagraph(node, undefined, undefined, undefined, resolver);

    expect(paragraph.type).toBe('paragraph');
    expect(paragraph.bookmarkName).toBe('section_overview');
    expect(paragraph.children.length).toBe(4);

    // Run 1: Overview
    const r1 = paragraph.children[0]!;
    expect(r1.text).toBe('Overview: ');
    expect(r1.bookmarkName).toBe('section_overview');

    // Run 2: Online Documentation (External link)
    const r2 = paragraph.children[1]!;
    expect(r2.text).toBe('Online Documentation');
    expect(r2.hyperlink).toBeDefined();
    expect(r2.hyperlink?.url).toBe('https://ooxen.dev/docs');
    expect(r2.hyperlink?.tooltip).toBe('Visit Docs');

    // Run 3: and
    const r3 = paragraph.children[2]!;
    expect(r3.text).toBe(' and ');

    // Run 4: See Appendix (Internal anchor link)
    const r4 = paragraph.children[3]!;
    expect(r4.text).toBe('See Appendix');
    expect(r4.hyperlink).toBeDefined();
    expect(r4.hyperlink?.anchor).toBe('section_appendix');
  });

  it('should parse hyperlinks via StandardDocumentParser and HyperlinkResolver', () => {
    const xml = `
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
        <w:body>
          <w:p>
            <w:hyperlink r:id="rIdLink1">
              <w:r><w:t>GitHub Repo</w:t></w:r>
            </w:hyperlink>
          </w:p>
        </w:body>
      </w:document>
    `;

    const resolver = new MapHyperlinkResolver();
    resolver.register('rIdLink1', 'https://github.com/rachmanzz/ooxen');

    const parser = new StandardDocumentParser();
    const doc = parser.parseDocumentXml(xml, undefined, undefined, undefined, undefined, resolver);

    expect(doc.sections.length).toBe(1);
    const p = doc.sections[0]!.children[0];
    expect(p?.type).toBe('paragraph');
    if (p?.type === 'paragraph') {
      const r = p.children[0]!;
      expect(r.text).toBe('GitHub Repo');
      expect(r.hyperlink?.url).toBe('https://github.com/rachmanzz/ooxen');
    }
  });
});
