import { describe, expect, it } from 'bun:test';
import { createPackage } from '../../src/opc/package.js';
import { KNOWN_RELATIONSHIPS } from '../../src/opc/relationships.js';
import { defaultXmlAdapter } from '../../src/parser/xml-adapter.js';
import { openDocument, parsePackage } from '../../src/parser/wml/document-parser.js';
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

  it('never double-decodes references in either order (F-PENT-REF)', () => {
    // &#38;lt; is the literal text "&lt;", and &amp;#65; is the literal "&#65;".
    expect(defaultXmlAdapter.parse(`<w:t ${W}>&#38;lt;</w:t>`).textContent).toBe('&lt;');
    expect(defaultXmlAdapter.parse(`<w:t ${W}>&#x26;amp;</w:t>`).textContent).toBe('&amp;');
    expect(defaultXmlAdapter.parse(`<w:t ${W}>&amp;#65;</w:t>`).textContent).toBe('&#65;');
  });

  it('keeps hyperlinks and tracked changes inside run-level content controls (F-PSDT-RUN)', () => {
    const xml = `<w:p ${W} ${R}><w:sdt><w:sdtContent>` +
      `<w:hyperlink w:anchor="sec3"><w:r><w:t>See 3</w:t></w:r></w:hyperlink>` +
      `<w:ins w:id="1" w:author="A"><w:r><w:t>added</w:t></w:r></w:ins>` +
      `<w:fldSimple w:instr="PAGE"><w:r><w:t>7</w:t></w:r></w:fldSimple>` +
      `</w:sdtContent></w:sdt></w:p>`;
    const para = new StandardParagraphParser().parseParagraph(defaultXmlAdapter.parse(xml));
    const text = paraText(para.children as { text?: string }[]);
    expect(text).toContain('See 3');
    expect(text).toContain('added');
    expect(text).toContain('7');
    expect(para.children.find((r) => r.text === 'See 3')?.hyperlink?.anchor).toBe('sec3');
    expect(para.children.find((r) => r.text === 'added')?.revision?.type).toBe('insert');
    expect(para.children.find((r) => r.text === '7')?.field).toBeDefined();
  });

  it('resolves relationship targets against the source part before any raw-name match (F-PDOT-URI)', () => {
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
      data: enc.encode(`<w:hdr ${W} ${R}><w:p><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">` +
        `<wp:extent cx="914400" cy="914400"/><wp:docPr id="1" name="Logo"/>` +
        `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
        `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:blipFill><a:blip r:embed="rIdI"/></pic:blipFill></pic:pic>` +
        `</a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p></w:hdr>`),
    });
    pkg.addRelationship('word/header1.xml', { id: 'rIdI', type: KNOWN_RELATIONSHIPS.IMAGE, target: 'media/image1.png' });
    // A root-level part with the same raw name must not shadow word/media/image1.png.
    pkg.setPart({ name: 'media/image1.png', contentType: 'image/png', data: enc.encode('ROOT') });
    pkg.setPart({ name: 'word/media/image1.png', contentType: 'image/png', data: enc.encode('WORD') });
    const doc = parsePackage(pkg);
    const header = doc.sections[0]!.headers?.default;
    const run = header?.children[0]?.type === 'paragraph' ? header.children[0].children.find((r) => r.image) : undefined;
    expect(new TextDecoder().decode(run?.image?.data)).toBe('WORD');
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
