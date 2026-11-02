import { describe, expect, it } from 'bun:test';
import {
  MapFootnoteResolver,
  parseEndnotesXml,
  parseFootnotesXml,
} from '../../src/parser/wml/footnote-parser.js';
import { StandardParagraphParser } from '../../src/parser/wml/paragraph-parser.js';
import { defaultXmlAdapter } from '../../src/parser/xml-adapter.js';

describe('ISO/IEC 29500 Footnotes & Endnotes Parser', () => {
  const paragraphParser = new StandardParagraphParser();

  describe('parseFootnotesXml', () => {
    it('should parse footnotes including standard separators and content footnotes', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:footnote w:type="separator" w:id="-1">
    <w:p><w:r><w:separator/></w:r></w:p>
  </w:footnote>
  <w:footnote w:type="continuationSeparator" w:id="0">
    <w:p><w:r><w:continuationSeparator/></w:r></w:p>
  </w:footnote>
  <w:footnote w:id="1">
    <w:p>
      <w:r><w:footnoteRef/></w:r>
      <w:r><w:t>First citation footnote text.</w:t></w:r>
    </w:p>
  </w:footnote>
  <w:footnote w:id="2">
    <w:p>
      <w:r><w:footnoteRef/></w:r>
      <w:r><w:t>Second citation footnote text.</w:t></w:r>
    </w:p>
  </w:footnote>
</w:footnotes>`;

      const notes = parseFootnotesXml(xml);
      expect(notes.length).toBe(4);

      expect(notes[0]?.id).toBe(-1);
      expect(notes[0]?.typeCategory).toBe('separator');

      expect(notes[1]?.id).toBe(0);
      expect(notes[1]?.typeCategory).toBe('continuationSeparator');

      expect(notes[2]?.id).toBe(1);
      expect(notes[2]?.kind).toBe('footnote');
      expect(notes[2]?.children.length).toBe(1);

      const p1 = notes[2]?.children[0];
      expect(p1?.type).toBe('paragraph');
      if (p1?.type === 'paragraph') {
        expect(p1.children[0]?.isFootnoteRefMark).toBe(true);
        expect(p1.children[1]?.text).toBe('First citation footnote text.');
      }

      expect(notes[3]?.id).toBe(2);
    });
  });

  describe('parseEndnotesXml', () => {
    it('should parse endnotes structure with endnote references', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:endnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:endnote w:type="separator" w:id="-1">
    <w:p><w:r><w:separator/></w:r></w:p>
  </w:endnote>
  <w:endnote w:id="1">
    <w:p>
      <w:r><w:endnoteRef/></w:r>
      <w:r><w:t>Endnote bibliographic reference.</w:t></w:r>
    </w:p>
  </w:endnote>
</w:endnotes>`;

      const notes = parseEndnotesXml(xml);
      expect(notes.length).toBe(2);
      expect(notes[0]?.id).toBe(-1);
      expect(notes[1]?.id).toBe(1);
      expect(notes[1]?.kind).toBe('endnote');

      const p = notes[1]?.children[0];
      if (p?.type === 'paragraph') {
        expect(p.children[0]?.isFootnoteRefMark).toBe(true);
        expect(p.children[1]?.text).toBe('Endnote bibliographic reference.');
      }
    });
  });

  describe('paragraphParser with footnoteReference', () => {
    it('should parse inline <w:footnoteReference> and <w:endnoteReference>', () => {
      const xml = `<w:p xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:r><w:t>Referenced sentence</w:t></w:r>
  <w:r>
    <w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr>
    <w:footnoteReference w:id="1"/>
  </w:r>
  <w:r><w:t> and endnote</w:t></w:r>
  <w:r>
    <w:endnoteReference w:id="2"/>
  </w:r>
</w:p>`;

      const node = defaultXmlAdapter.parse(xml);
      const paragraph = paragraphParser.parseParagraph(node);

      expect(paragraph.children.length).toBe(4);
      expect(paragraph.children[0]?.text).toBe('Referenced sentence');

      const fnRefRun = paragraph.children[1];
      expect(fnRefRun?.footnoteRef).toBeDefined();
      expect(fnRefRun?.footnoteRef?.id).toBe(1);
      expect(fnRefRun?.footnoteRef?.kind).toBe('footnote');

      const enRefRun = paragraph.children[3];
      expect(enRefRun?.footnoteRef).toBeDefined();
      expect(enRefRun?.footnoteRef?.id).toBe(2);
      expect(enRefRun?.footnoteRef?.kind).toBe('endnote');
    });
  });

  describe('MapFootnoteResolver', () => {
    it('should register and resolve footnotes and endnotes by id', () => {
      const resolver = new MapFootnoteResolver();

      resolver.registerFootnote({
        type: 'footnote',
        kind: 'footnote',
        id: 1,
        children: [{ type: 'paragraph', children: [{ type: 'run', text: 'Footnote 1' }] }],
      });

      resolver.registerEndnote({
        type: 'endnote',
        kind: 'endnote',
        id: 1,
        children: [{ type: 'paragraph', children: [{ type: 'run', text: 'Endnote 1' }] }],
      });

      expect(resolver.resolveFootnote(1)).toBeDefined();
      expect(resolver.resolveFootnote(1)?.children[0]?.type).toBe('paragraph');
      expect(resolver.resolveFootnote(999)).toBeUndefined();

      expect(resolver.resolveEndnote(1)).toBeDefined();
      expect(resolver.resolveEndnote(999)).toBeUndefined();
    });
  });
});
