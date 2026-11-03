import { describe, expect, it } from 'bun:test';
import { StandardWmlBuilder } from '../../src/serializer/wml-builder.js';
import type { ParagraphNode } from '../../src/types/ast.js';

describe('Tab Stops Serializer (ISO/IEC 29500-1)', () => {
  const builder = new StandardWmlBuilder();

  it('serializes <w:tabs> element in paragraph properties', () => {
    const p: ParagraphNode = {
      type: 'paragraph',
      style: {
        tabStops: [
          { positionPt: 72, alignment: 'left' },
          { positionPt: 432, alignment: 'right', leader: 'dot' },
        ],
      },
      children: [
        {
          type: 'run',
          text: 'Title\tPage',
        },
      ],
    };

    const xml = builder.buildParagraphXml(p);
    expect(xml).toContain('<w:tabs>');
    expect(xml).toContain('<w:tab w:val="left" w:pos="1440"/>');
    expect(xml).toContain('<w:tab w:val="right" w:pos="8640" w:leader="dot"/>');
    expect(xml).toContain('</w:tabs>');
  });

  it('serializes <w:tab/> inside <w:r>', () => {
    const p: ParagraphNode = {
      type: 'paragraph',
      children: [
        {
          type: 'run',
          text: 'First\tSecond',
        },
      ],
    };

    const xml = builder.buildParagraphXml(p);
    expect(xml).toContain('<w:r>');
    expect(xml).toContain('<w:t>First</w:t>');
    expect(xml).toContain('<w:tab/>');
    expect(xml).toContain('<w:t>Second</w:t>');
  });
});
