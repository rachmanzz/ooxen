import { describe, expect, it } from 'bun:test';
import { parseParagraphProperties } from '../../src/parser/wml/style-resolver.js';
import { StandardParagraphParser } from '../../src/parser/wml/paragraph-parser.js';
import type { XmlNode } from '../../src/parser/xml-adapter.js';

describe('Tab Stops Parser (ISO/IEC 29500-1 §17.3.1.38 & §17.3.2.37)', () => {
  it('parses custom tab stops in paragraph properties', () => {
    const pPrXml: XmlNode = {
      nodeName: 'w:pPr',
      attributes: {},
      children: [
        {
          nodeName: 'w:tabs',
          attributes: {},
          children: [
            {
              nodeName: 'w:tab',
              attributes: {
                'w:val': 'left',
                'w:pos': '1440', // 72 pt
              },
              children: [],
            },
            {
              nodeName: 'w:tab',
              attributes: {
                'w:val': 'right',
                'w:pos': '8640', // 432 pt
                'w:leader': 'dot',
              },
              children: [],
            },
            {
              nodeName: 'w:tab',
              attributes: {
                'w:val': 'center',
                'w:pos': '4320', // 216 pt
                'w:leader': 'hyphen',
              },
              children: [],
            },
          ],
        },
      ],
    };

    const style = parseParagraphProperties(pPrXml);
    expect(style.tabStops).toBeDefined();
    expect(style.tabStops?.length).toBe(3);

    const [t1, t2, t3] = style.tabStops!;
    expect(t1?.positionPt).toBe(72);
    expect(t1?.alignment).toBe('left');
    expect(t1?.leader).toBe('none');

    expect(t2?.positionPt).toBe(432);
    expect(t2?.alignment).toBe('right');
    expect(t2?.leader).toBe('dot');

    expect(t3?.positionPt).toBe(216);
    expect(t3?.alignment).toBe('center');
    expect(t3?.leader).toBe('hyphen');
  });

  it('parses <w:tab/> run element as tab run with isTab: true', () => {
    const parser = new StandardParagraphParser();
    const pXml: XmlNode = {
      nodeName: 'w:p',
      attributes: {},
      children: [
        {
          nodeName: 'w:r',
          attributes: {},
          children: [
            {
              nodeName: 'w:t',
              attributes: {},
              children: [],
              textContent: 'Left text',
            },
            {
              nodeName: 'w:tab',
              attributes: {},
              children: [],
            },
            {
              nodeName: 'w:t',
              attributes: {},
              children: [],
              textContent: 'Right text',
            },
          ],
        },
      ],
    };

    const paragraph = parser.parseParagraph(pXml);
    expect(paragraph.children.length).toBe(1);
    const run = paragraph.children[0]!;
    expect(run.text).toBe('Left text\tRight text');
    expect(run.isTab).toBe(true);
  });
});
