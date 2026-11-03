import { describe, expect, it } from 'bun:test';
import { defaultXmlAdapter } from '../../src/parser/xml-adapter.js';
import {
  hasMarkupCompatibility,
  resolveMarkupCompatibility,
} from '../../src/parser/mce.js';
import { StandardDocumentParser } from '../../src/parser/wml/document-parser.js';


const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const parser = new StandardDocumentParser();

/** Deep folded text — mirrors how consumers read w:t content. */
function deepText(node: import('../../src/parser/xml-adapter.js').XmlNode): string {
  return (node.childNodes ?? [])
    .map((child) => (child.kind === 'text' ? (child.value ?? '') : deepText(child)))
    .join('');
}

function resolve(xml: string) {
  return resolveMarkupCompatibility(defaultXmlAdapter.parse(xml));
}

describe('Markup Compatibility resolution (ISO/IEC 29500-3)', () => {
  it('selects the supported Choice branch in place', () => {
    const xml = `<w:p xmlns:w="${W_NS}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">
      <mc:AlternateContent>
        <mc:Choice Requires="wps"><w:r><w:t>modern</w:t></w:r></mc:Choice>
        <mc:Fallback><w:r><w:t>fallback</w:t></w:r></mc:Fallback>
      </mc:AlternateContent>
    </w:p>`;
    const node = resolve(xml);

    // The AlternateContent wrapper is replaced by the Choice content at its
    // original position.
    expect(node.children.map((c) => c.nodeName)).toEqual(['w:r']);
    expect(deepText(node.children[0]!)).toBe('modern');
  });

  it('falls back when a Requires prefix is unsupported', () => {
    const xml = `<w:p xmlns:w="${W_NS}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">
      <mc:AlternateContent>
        <mc:Choice Requires="w14"><w:r><w:t>extension</w:t></w:r></mc:Choice>
        <mc:Fallback><w:r><w:t>fallback</w:t></w:r></mc:Fallback>
      </mc:AlternateContent>
    </w:p>`;
    const node = resolve(xml);
    expect(deepText(node.children[0]!)).toBe('fallback');
  });

  it('falls back when a Requires prefix is not even declared', () => {
    const xml = `<w:p xmlns:w="${W_NS}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006">
      <mc:AlternateContent>
        <mc:Choice Requires="unknown"><w:r><w:t>modern</w:t></w:r></mc:Choice>
        <mc:Fallback><w:r><w:t>fallback</w:t></w:r></mc:Fallback>
      </mc:AlternateContent>
    </w:p>`;
    const node = resolve(xml);
    expect(deepText(node.children[0]!)).toBe('fallback');
  });

  it('drops the wrapper entirely when neither branch applies', () => {
    const xml = `<w:p xmlns:w="${W_NS}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">
      <w:r><w:t>before</w:t></w:r>
      <mc:AlternateContent>
        <mc:Choice Requires="w14"><w:r><w:t>extension</w:t></w:r></mc:Choice>
      </mc:AlternateContent>
    </w:p>`;
    const node = resolve(xml);
    expect(node.children.map((c) => deepText(c))).toEqual(['before']);
  });

  it('resolves nested AlternateContent inside a chosen branch', () => {
    const xml = `<w:p xmlns:w="${W_NS}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">
      <mc:AlternateContent>
        <mc:Choice Requires="wps">
          <mc:AlternateContent>
            <mc:Choice Requires="w14"><w:r><w:t>nested-unsupported</w:t></w:r></mc:Choice>
            <mc:Fallback><w:r><w:t>nested-fallback</w:t></w:r></mc:Fallback>
          </mc:AlternateContent>
        </mc:Choice>
        <mc:Fallback><w:r><w:t>outer-fallback</w:t></w:r></mc:Fallback>
      </mc:AlternateContent>
    </w:p>`;
    const node = resolve(xml);
    expect(node.children.map((c) => deepText(c))).toEqual(['nested-fallback']);
  });

  it('prefers the first supported Choice among several', () => {
    const xml = `<w:p xmlns:w="${W_NS}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">
      <mc:AlternateContent>
        <mc:Choice Requires="wps"><w:r><w:t>first</w:t></w:r></mc:Choice>
        <mc:Choice Requires="wps"><w:r><w:t>second</w:t></w:r></mc:Choice>
        <mc:Fallback><w:r><w:t>fallback</w:t></w:r></mc:Fallback>
      </mc:AlternateContent>
    </w:p>`;
    const node = resolve(xml);
    expect(deepText(node.children[0]!)).toBe('first');
  });

  it('skips the tree walk when the XML has no MCE markup', () => {
    expect(hasMarkupCompatibility('<w:p><w:r><w:t>x</w:t></w:r></w:p>')).toBe(false);
    expect(hasMarkupCompatibility('<w:p><mc:AlternateContent/></w:p>')).toBe(true);
    expect(hasMarkupCompatibility('<w:document mc:Ignorable="w14"/>')).toBe(true);
  });
});

describe('MCE integration with the document parser', () => {
  it('parses paragraphs hidden inside AlternateContent/Fallback', () => {
    const xml = `<w:document xmlns:w="${W_NS}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">
  <w:body>
    <w:p><w:r><w:t>Plain paragraph</w:t></w:r></w:p>
    <mc:AlternateContent>
      <mc:Choice Requires="w14"><w:p><w:r><w:t>Word 2010 only</w:t></w:r></w:p></mc:Choice>
      <mc:Fallback><w:p><w:r><w:t>Fallback paragraph</w:t></w:r></w:p></mc:Fallback>
    </mc:AlternateContent>
    <w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr>
  </w:body>
</w:document>`;

    const doc = parser.parseDocument(resolveMarkupCompatibility(defaultXmlAdapter.parse(xml)));
    const texts = doc.sections[0]!.children
      .filter((b): b is Extract<typeof b, { type: 'paragraph' }> => b.type === 'paragraph')
      .map((p) => p.children.map((r) => r.text).join(''));
    expect(texts).toContain('Plain paragraph');
    expect(texts).toContain('Fallback paragraph');
    expect(texts).not.toContain('Word 2010 only');
  });
});
