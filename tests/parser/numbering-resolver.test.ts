import { describe, expect, it } from 'bun:test';
import {
  normalizeBulletSymbol,
  StandardNumberingResolver,
  toLowerLetter,
  toRoman,
} from '../../src/parser/wml/numbering-resolver.js';
import { StandardDocumentParser } from '../../src/parser/wml/document-parser.js';

describe('Numbering Resolver & Multilevel Lists', () => {
  it('should convert numbers to lowercase alphabet letters correctly', () => {
    expect(toLowerLetter(1)).toBe('a');
    expect(toLowerLetter(2)).toBe('b');
    expect(toLowerLetter(26)).toBe('z');
    expect(toLowerLetter(27)).toBe('aa');
  });

  it('should convert numbers to Roman numerals correctly', () => {
    expect(toRoman(1, false)).toBe('i');
    expect(toRoman(4, false)).toBe('iv');
    expect(toRoman(9, false)).toBe('ix');
    expect(toRoman(14, true)).toBe('XIV');
  });

  it('should normalize bullet symbols', () => {
    expect(normalizeBulletSymbol('')).toBe('•');
    expect(normalizeBulletSymbol('o')).toBe('◦');
    expect(normalizeBulletSymbol('')).toBe('▪');
    expect(normalizeBulletSymbol('•')).toBe('•');
  });

  it('should parse numbering.xml and resolve sequential and multilevel counters', () => {
    const numberingXml = `
      <w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:abstractNum w:abstractNumId="10">
          <w:multiLevelType w:val="multilevel"/>
          <w:lvl w:ilvl="0">
            <w:start w:val="1"/>
            <w:numFmt w:val="decimal"/>
            <w:lvlText w:val="%1."/>
            <w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr>
          </w:lvl>
          <w:lvl w:ilvl="1">
            <w:start w:val="1"/>
            <w:numFmt w:val="lowerLetter"/>
            <w:lvlText w:val="%1.%2)"/>
            <w:pPr><w:ind w:left="1440" w:hanging="360"/></w:pPr>
          </w:lvl>
        </w:abstractNum>
        <w:abstractNum w:abstractNumId="20">
          <w:lvl w:ilvl="0">
            <w:numFmt w:val="bullet"/>
            <w:lvlText w:val=""/>
            <w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr>
          </w:lvl>
        </w:abstractNum>
        <w:num w:numId="1">
          <w:abstractNumId w:val="10"/>
        </w:num>
        <w:num w:numId="2">
          <w:abstractNumId w:val="20"/>
        </w:num>
      </w:numbering>
    `;

    const resolver = new StandardNumberingResolver();
    resolver.parseNumberingXml(numberingXml);

    // Level 0: first item -> "1."
    const item1 = resolver.resolveNumbering(1, 0);
    expect(item1?.prefixText).toBe('1.');
    expect(item1?.format).toBe('decimal');
    expect(item1?.indentLeftPt).toBe(36); // 720 twips = 36 pt
    expect(item1?.hangingPt).toBe(18); // 360 twips = 18 pt

    // Level 1 nested sub-item -> "1.a)"
    const sub1 = resolver.resolveNumbering(1, 1);
    expect(sub1?.prefixText).toBe('1.a)');
    expect(sub1?.format).toBe('lowerLetter');

    // Level 1 nested sub-item -> "1.b)"
    const sub2 = resolver.resolveNumbering(1, 1);
    expect(sub2?.prefixText).toBe('1.b)');

    // Level 0: second item -> "2." (should reset level 1 counter)
    const item2 = resolver.resolveNumbering(1, 0);
    expect(item2?.prefixText).toBe('2.');

    // Level 1 under item 2 -> starts fresh from 'a' -> "2.a)"
    const sub3 = resolver.resolveNumbering(1, 1);
    expect(sub3?.prefixText).toBe('2.a)');

    // Bullet list
    const bullet1 = resolver.resolveNumbering(2, 0);
    expect(bullet1?.prefixText).toBe('•');
    expect(bullet1?.format).toBe('bullet');
  });

  it('should resolve numbering within document XML paragraphs', () => {
    const numberingXml = `
      <w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:abstractNum w:abstractNumId="1">
          <w:lvl w:ilvl="0">
            <w:start w:val="1"/>
            <w:numFmt w:val="decimal"/>
            <w:lvlText w:val="Item %1:"/>
          </w:lvl>
        </w:abstractNum>
        <w:num w:numId="5">
          <w:abstractNumId w:val="1"/>
        </w:num>
      </w:numbering>
    `;

    const docXml = `
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:body>
          <w:p>
            <w:pPr>
              <w:numPr>
                <w:ilvl w:val="0"/>
                <w:numId w:val="5"/>
              </w:numPr>
            </w:pPr>
            <w:r><w:t>First Step</w:t></w:r>
          </w:p>
          <w:p>
            <w:pPr>
              <w:numPr>
                <w:ilvl w:val="0"/>
                <w:numId w:val="5"/>
              </w:numPr>
            </w:pPr>
            <w:r><w:t>Second Step</w:t></w:r>
          </w:p>
        </w:body>
      </w:document>
    `;

    const resolver = new StandardNumberingResolver();
    resolver.parseNumberingXml(numberingXml);

    const docParser = new StandardDocumentParser();
    const doc = docParser.parseDocumentXml(docXml, undefined, resolver);

    const p1 = doc.sections[0]!.children[0]!;
    const p2 = doc.sections[0]!.children[1]!;

    expect(p1.type).toBe('paragraph');
    expect(p2.type).toBe('paragraph');

    if (p1.type === 'paragraph' && p2.type === 'paragraph') {
      expect(p1.style?.numbering?.prefixText).toBe('Item 1:');
      expect(p2.style?.numbering?.prefixText).toBe('Item 2:');
    }
  });
});
