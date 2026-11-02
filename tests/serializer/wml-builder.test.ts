import { describe, expect, it } from 'bun:test';
import { defaultXmlAdapter } from '../../src/parser/xml-adapter.js';
import { StandardWmlBuilder } from '../../src/serializer/wml-builder.js';
import type { DocumentNode } from '../../src/types/ast.js';

describe('WordprocessingML Builder (ISO/IEC 29500-1)', () => {
  const wmlBuilder = new StandardWmlBuilder();

  it('should generate valid WordprocessingML XML with namespaces and preserve space', () => {
    const doc: DocumentNode = {
      type: 'document',
      sections: [
        {
          type: 'section',
          properties: {
            pageSize: { width: 612, height: 792 },
            margins: { top: 72, right: 72, bottom: 72, left: 72 },
          },
          children: [
            {
              type: 'paragraph',
              style: { alignment: 'center', spaceBeforePt: 12, spaceAfterPt: 6 },
              children: [
                {
                  type: 'run',
                  text: ' Leading and trailing space ',
                  style: { bold: true, fontSizePt: 16, color: '#FF0000' },
                },
              ],
            },
          ],
        },
      ],
    };

    const xml = wmlBuilder.buildDocumentXml(doc);

    // 1. Structure checks
    expect(xml).toContain('xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"');
    expect(xml).toContain('<w:jc w:val="center"/>');
    expect(xml).toContain('w:before="240"'); // 12pt * 20
    expect(xml).toContain('w:after="120"'); // 6pt * 20
    expect(xml).toContain('<w:b/>');
    expect(xml).toContain('<w:sz w:val="32"/>'); // 16pt * 2
    expect(xml).toContain('<w:color w:val="FF0000"/>');
    expect(xml).toContain('xml:space="preserve"');

    // 2. XML well-formedness verification
    const parsed = defaultXmlAdapter.parse(xml);
    expect(parsed).toBeDefined();
    expect(parsed.nodeName).toBe('w:document');
  });
});
