import { describe, expect, it } from 'bun:test';
import { parseImageNode } from '../../src/parser/dml/image-parser.js';
import { defaultXmlAdapter } from '../../src/parser/xml-adapter.js';
import { defaultTableParser } from '../../src/parser/wml/table-parser.js';
import { defaultDocumentParser } from '../../src/parser/wml/document-parser.js';

const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const V_NS = 'xmlns:v="urn:schemas-microsoft-com:vml"';
const R_NS = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

// F-VMLSDT: VML imagedata hosts beyond v:shape, and w:sdt content controls,
// must not silently drop content.
describe('VML shapes and content controls (F-VMLSDT)', () => {
  it('parses v:rect imagedata as an image', () => {
    const xml =
      `<w:pict ${W_NS} ${V_NS} ${R_NS}>` +
      '<v:rect id="r1" style="width:100pt;height:50pt">' +
      '<v:imagedata r:id="rId5"/>' +
      '</v:rect></w:pict>';
    const data = new Uint8Array([1, 2, 3]);
    const node = parseImageNode(defaultXmlAdapter.parse(xml), {
      resolveImage: (id) => (id === 'rId5' ? { data, mimeType: 'image/png' } : undefined),
    });
    expect(node).toBeDefined();
    expect(node?.relationshipId).toBe('rId5');
    expect(node?.data).toEqual(data);
    expect(node?.widthPt).toBeGreaterThan(0);
    expect(node?.heightPt).toBeGreaterThan(0);
  });

  it('parses w:sdt content in the document body', () => {
    const xml =
      `<w:document ${W_NS}><w:body>` +
      '<w:sdt><w:sdtPr><w:alias w:val="Title"/></w:sdtPr><w:sdtContent>' +
      '<w:p><w:r><w:t>Control text.</w:t></w:r></w:p>' +
      '</w:sdtContent></w:sdt>' +
      '</w:body></w:document>';
    const doc = defaultDocumentParser.parseDocumentXml(xml);
    const text = JSON.stringify(doc.sections[0]!.children);
    expect(text).toContain('Control text.');
  });

  it('parses w:sdt content inside table cells', () => {
    const xml =
      `<w:tbl ${W_NS}><w:tr><w:tc>` +
      '<w:sdt><w:sdtContent>' +
      '<w:p><w:r><w:t>Cell control text.</w:t></w:r></w:p>' +
      '</w:sdtContent></w:sdt>' +
      '<w:p/></w:tc></w:tr></w:tbl>';
    const table = defaultTableParser.parseTable(defaultXmlAdapter.parse(xml));
    const text = JSON.stringify(table.rows[0]!.children[0]!.children);
    expect(text).toContain('Cell control text.');
  });
});
