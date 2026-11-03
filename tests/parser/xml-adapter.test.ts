import { describe, expect, it } from 'bun:test';
import {
  defaultXmlAdapter,
  serializeXmlNode,
  type XmlNode,
} from '../../src/parser/xml-adapter.js';

/** Structural equality: element name, attributes, and typed child order. */
function expectTreesEqual(actual: XmlNode, expected: XmlNode): void {
  expect(actual.nodeName).toBe(expected.nodeName);
  expect(Object.entries(actual.attributes)).toEqual(Object.entries(expected.attributes));
  const actualChildren = actual.childNodes ?? [];
  const expectedChildren = expected.childNodes ?? [];
  expect(actualChildren.length).toBe(expectedChildren.length);
  for (let i = 0; i < actualChildren.length; i++) {
    expect(actualChildren[i]!.kind).toBe(expectedChildren[i]!.kind);
    expectTreesEqual(actualChildren[i]!, expectedChildren[i]!);
  }
}

describe('Lossless XML adapter (futures §5.1)', () => {
  it('preserves the exact interleaving of text nodes and elements', () => {
    const xml = '<w:r><w:t>a</w:t><w:br/><w:t xml:space="preserve"> b </w:t><w:tab/><w:t>c</w:t></w:r>';
    const node = defaultXmlAdapter.parse(xml);
    const childNodes = node.childNodes ?? [];

    expect(childNodes.map((c) => c.nodeName)).toEqual(['w:t', 'w:br', 'w:t', 'w:tab', 'w:t']);
    expect(childNodes[0]!.textContent).toBe('a');
    expect(childNodes[2]!.textContent).toBe(' b ');
  });

  it('preserves whitespace-only text nodes between elements', () => {
    const xml = '<w:p>  <w:r><w:t>x</w:t></w:r>\n  <w:r/>  </w:p>';
    const node = defaultXmlAdapter.parse(xml);
    const childNodes = node.childNodes ?? [];

    // text, w:r, text, w:r, text
    expect(childNodes.map((c) => c.kind)).toEqual(['text', 'element', 'text', 'element', 'text']);
    expect(childNodes[0]!.value).toBe('  ');
    expect(childNodes[2]!.value).toBe('\n  ');
  });

  it('preserves comments as typed nodes', () => {
    const xml = '<w:settings><!-- audit marker --><w:zoom w:percent="100"/></w:settings>';
    const node = defaultXmlAdapter.parse(xml);
    const childNodes = node.childNodes ?? [];

    expect(childNodes[0]!.kind).toBe('comment');
    expect(childNodes[0]!.value).toBe(' audit marker ');
    expect(childNodes[1]!.nodeName).toBe('w:zoom');
  });

  it('round-trips a document through serialize/parse without structural change', () => {
    const xml = [
      '<w:body>',
      '  <w:p w14:paraId="123">',
      '    <w:r><w:t>hello &amp; goodbye</w:t><w:br w:type="page"/></w:r>',
      '    <!-- inline comment -->',
      '    <w:sectPr><w:pgSz w:w="11906"/></w:sectPr>',
      '  </w:p>',
      '</w:body>',
    ].join('\n');

    const once = defaultXmlAdapter.parse(xml);
    const serializedOnce = serializeXmlNode(once);
    const twice = defaultXmlAdapter.parse(serializedOnce);
    const serializedTwice = serializeXmlNode(twice);

    expectTreesEqual(twice, once);
    expect(serializedTwice).toBe(serializedOnce);
  });

  it('preserves attribute order and entity content on re-serialization', () => {
    const xml = '<w:tblW w:type="dxa" w:w="500" w:attr-with-entities="a&quot;b&lt;c"/>';
    const node = defaultXmlAdapter.parse(xml);
    const serialized = serializeXmlNode(node);
    expect(serialized).toBe('<w:tblW w:type="dxa" w:w="500" w:attr-with-entities="a&quot;b&lt;c"/>');
  });

  it('emits self-closing tags for empty elements', () => {
    const node = defaultXmlAdapter.parse('<w:br w:type="page"/>');
    expect(serializeXmlNode(node)).toBe('<w:br w:type="page"/>');
  });

  it('inlines CDATA content as text verbatim', () => {
    const node = defaultXmlAdapter.parse('<w:t><![CDATA[a < b & c]]></w:t>');
    expect(node.textContent).toBe('a < b & c');
    expect(serializeXmlNode(node)).toBe('<w:t>a &lt; b &amp; c</w:t>');
    // Re-parse is stable: same infoset.
    expect(defaultXmlAdapter.parse(serializeXmlNode(node)).textContent).toBe('a < b & c');
  });
});
