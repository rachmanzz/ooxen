import { describe, expect, it } from 'bun:test';
import { createPackage } from '../../src/opc/package.js';
import { KNOWN_RELATIONSHIPS } from '../../src/opc/relationships.js';
import { defaultXmlAdapter } from '../../src/parser/xml-adapter.js';
import { openDocument } from '../../src/parser/wml/document-parser.js';
import { StandardParagraphParser } from '../../src/parser/wml/paragraph-parser.js';

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const M = 'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"';

const paraText = (children: { text?: string }[]): string =>
  children.map((r) => ('text' in r && typeof r.text === 'string' ? r.text : '')).join('');

// P1 parser correctness batch (v4 roast): run-level content controls,
// equations, numeric entities, and part-local hyperlink resolution must
// not silently drop content.
describe('Content fidelity (F-PSDT-RUN, F-PMATH, F-PENT-REF, F-PLINK-PART)', () => {
  it('unwraps run-level content controls inline (F-PSDT-RUN)', () => {
    const xml = `<w:p ${W}><w:sdt><w:sdtPr><w:alias w:val="Name"/></w:sdtPr>` +
      `<w:sdtContent><w:r><w:t>Inline control</w:t></w:r></w:sdtContent></w:sdt></w:p>`;
    const para = new StandardParagraphParser().parseParagraph(defaultXmlAdapter.parse(xml));
    expect(paraText(para.children as { text?: string }[])).toContain('Inline control');
  });

  it('extracts equation text instead of dropping OMML (F-PMATH)', () => {
    const xml = `<w:p ${W}><m:oMathPara ${M}><m:oMath><m:r><m:t>x</m:t></m:r>` +
      `<m:r><m:t>+1</m:t></m:r></m:oMath></m:oMathPara></w:p>`;
    const para = new StandardParagraphParser().parseParagraph(defaultXmlAdapter.parse(xml));
    expect(paraText(para.children as { text?: string }[])).toContain('x+1');
  });

  it('decodes numeric character references (F-PENT-REF)', () => {
    const node = defaultXmlAdapter.parse(`<w:t ${W}>A&#8211;B&#x41;</w:t>`);
    expect(node.textContent).toBe('A\u2013BA');
  });

  it('resolves part-local hyperlink ids in headers and footnotes (F-PLINK-PART)', async () => {
    const enc = new TextEncoder();
    const pkg = createPackage();
    pkg.addRelationship(undefined, { id: 'rId1', type: KNOWN_RELATIONSHIPS.DOCUMENT, target: 'word/document.xml' });
    pkg.setPart({
      name: 'word/document.xml',
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
      data: enc.encode(`<w:document ${W} ${R}><w:body><w:p><w:r><w:t>Body</w:t></w:r></w:p>` +
        `<w:sectPr><w:headerReference w:type="default" r:id="rIdH"/></w:sectPr></w:body></w:document>`),
    });
    pkg.addRelationship('word/document.xml', { id: 'rIdH', type: KNOWN_RELATIONSHIPS.HEADER, target: 'header1.xml' });
    pkg.setPart({
      name: 'word/header1.xml',
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml',
      data: enc.encode(`<w:hdr ${W} ${R}><w:p><w:hyperlink r:id="rIdL1"><w:r><w:t>Hi</w:t></w:r></w:hyperlink></w:p></w:hdr>`),
    });
    pkg.addRelationship('word/header1.xml', {
      id: 'rIdL1', type: KNOWN_RELATIONSHIPS.HYPERLINK, target: 'https://header.example/', targetMode: 'External',
    });
    // A document-level hyperlink with the SAME id must not shadow the header one.
    pkg.addRelationship('word/document.xml', {
      id: 'rIdL1', type: KNOWN_RELATIONSHIPS.HYPERLINK, target: 'https://doc.example/', targetMode: 'External',
    });

    const doc = await openDocument(await pkg.serialize());
    const hdr = doc.sections[0]?.headers?.default;
    const urls: (string | undefined)[] = [];
    for (const b of hdr?.children ?? []) {
      if (b.type === 'paragraph') for (const r of b.children) urls.push(r.hyperlink?.url);
    }
    expect(urls).toContain('https://header.example/');
    expect(urls).not.toContain('https://doc.example/');
  });
});
