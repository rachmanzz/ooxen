import { describe, expect, it } from 'bun:test';
import { StandardWmlBuilder } from '../../src/serializer/wml-builder.js';
import { defaultXmlAdapter } from '../../src/parser/xml-adapter.js';
import { parseSectionProperties } from '../../src/parser/wml/document-parser.js';
import type { SectionNode } from '../../src/types/ast.js';

describe('ISO/IEC 29500 Section Properties Serializer', () => {
  it('should serialize orientation, break type, and page numbering to valid sectPr XML', () => {
    const section: SectionNode = {
      type: 'section',
      properties: {
        pageSize: { width: 842, height: 595 },
        margins: { top: 72, right: 72, bottom: 72, left: 72 },
        orientation: 'landscape',
        type: 'continuous',
        pageNumbering: { start: 10, format: 'lowerRoman' },
      },
      children: [],
    };

    const builder = new StandardWmlBuilder();
    const xml = builder.serializeSectionProperties(section);

    expect(xml).toContain('<w:sectPr>');
    expect(xml).toContain('<w:type w:val="continuous"/>');
    expect(xml).toContain('<w:pgNumType w:start="10" w:fmt="lowerRoman"/>');
    expect(xml).toContain('w:orient="landscape"');

    // Verify round-trip parsing from generated XML
    const parsedNode = defaultXmlAdapter.parse(xml);
    const parsedProps = parseSectionProperties(parsedNode);

    expect(parsedProps.orientation).toBe('landscape');
    expect(parsedProps.type).toBe('continuous');
    expect(parsedProps.pageNumbering?.start).toBe(10);
    expect(parsedProps.pageNumbering?.format).toBe('lowerRoman');
  });
});
