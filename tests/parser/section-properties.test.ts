import { describe, expect, it } from 'bun:test';
import { defaultXmlAdapter } from '../../src/parser/xml-adapter.js';
import { parseSectionProperties } from '../../src/parser/wml/document-parser.js';

describe('ISO/IEC 29500 Section Properties Parser', () => {
  it('should parse orientation landscape from w:pgSz', () => {
    const xml = `
<w:sectPr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/>
  <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>
</w:sectPr>`;

    const node = defaultXmlAdapter.parse(xml);
    const props = parseSectionProperties(node);

    expect(props.orientation).toBe('landscape');
    expect(props.pageSize.width).toBeCloseTo(841.9, 1);
    expect(props.pageSize.height).toBeCloseTo(595.3, 1);
  });

  it('should parse section break types (continuous, evenPage, oddPage)', () => {
    const xmlContinuous = `
<w:sectPr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:type w:val="continuous"/>
</w:sectPr>`;
    const props1 = parseSectionProperties(defaultXmlAdapter.parse(xmlContinuous));
    expect(props1.type).toBe('continuous');

    const xmlEven = `
<w:sectPr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:type w:val="evenPage"/>
</w:sectPr>`;
    const props2 = parseSectionProperties(defaultXmlAdapter.parse(xmlEven));
    expect(props2.type).toBe('evenPage');

    const xmlOdd = `
<w:sectPr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:type w:val="oddPage"/>
</w:sectPr>`;
    const props3 = parseSectionProperties(defaultXmlAdapter.parse(xmlOdd));
    expect(props3.type).toBe('oddPage');
  });

  it('should parse page numbering restart and format (w:pgNumType)', () => {
    const xml = `
<w:sectPr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:pgNumType w:start="5" w:fmt="upperRoman"/>
</w:sectPr>`;

    const node = defaultXmlAdapter.parse(xml);
    const props = parseSectionProperties(node);

    expect(props.pageNumbering).toBeDefined();
    expect(props.pageNumbering?.start).toBe(5);
    expect(props.pageNumbering?.format).toBe('upperRoman');
  });

  it('keeps finite defaults on malformed numeric attributes (F-NAN)', () => {
    const xml = `
<w:sectPr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:pgSz w:w="garbage" w:h="Infinity" w:orient="landscape"/>
  <w:pgMar w:top="abc" w:right="NaN" w:bottom="1440" w:left="1440" w:header="oops" w:footer="1440"/>
  <w:pgNumType w:start="NaN" w:fmt="decimal"/>
  <w:cols w:num="many" w:space="junk"><w:col w:w="bogus"/><w:col w:w="7200" w:space="bad"/></w:cols>
</w:sectPr>`;

    const props = parseSectionProperties(defaultXmlAdapter.parse(xml));

    expect(props.pageSize.width).toBe(612);
    expect(props.pageSize.height).toBe(792);
    expect(props.orientation).toBe('landscape');
    expect(props.margins.top).toBe(72);
    expect(props.margins.right).toBe(72);
    expect(props.margins.bottom).toBeCloseTo(72, 5);
    expect(props.margins.left).toBeCloseTo(72, 5);
    expect(props.pageNumbering?.start).toBeUndefined();
    expect(props.columns?.count).toBe(1);
    expect(props.columns?.spacePt).toBe(36);
    expect(props.columns?.columns?.length).toBe(1);
    expect(props.columns?.columns?.[0]?.widthPt).toBeCloseTo(360, 5);
    expect(props.columns?.columns?.[0]?.spacePt).toBeUndefined();
  });
});
