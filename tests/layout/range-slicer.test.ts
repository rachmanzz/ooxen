import { describe, expect, it } from 'bun:test';
import { getParagraphText, sliceParagraphRange } from '../../src/layout/range-slicer.js';
import { StandardWmlBuilder } from '../../src/serializer/wml-builder.js';
import type { DocumentNode, ParagraphNode } from '../../src/types/ast.js';

describe('Range Slicer & Run Splitting', () => {
  const wmlBuilder = new StandardWmlBuilder();

  it('should slice a single run into 3 runs when applying bold in the middle', () => {
    const paragraph: ParagraphNode = {
      type: 'paragraph',
      children: [
        {
          type: 'run',
          text: 'Halo dunia yang indah',
        },
      ],
    };

    expect(getParagraphText(paragraph)).toBe('Halo dunia yang indah');

    // Slice "dunia" at [5, 10]
    const updated = sliceParagraphRange(paragraph, 5, 10, { bold: true });

    expect(getParagraphText(updated)).toBe('Halo dunia yang indah');
    expect(updated.children.length).toBe(3);

    // Run 1: "Halo " (normal)
    expect(updated.children[0]?.text).toBe('Halo ');
    expect(updated.children[0]?.style?.bold).toBeFalsy();

    // Run 2: "dunia" (bold)
    expect(updated.children[1]?.text).toBe('dunia');
    expect(updated.children[1]?.style?.bold).toBe(true);

    // Run 3: " yang indah" (normal)
    expect(updated.children[2]?.text).toBe(' yang indah');
    expect(updated.children[2]?.style?.bold).toBeFalsy();
  });

  it('should slice across existing multiple run boundaries', () => {
    const paragraph: ParagraphNode = {
      type: 'paragraph',
      children: [
        { type: 'run', text: 'Halo ', style: { color: '#000000' } },
        { type: 'run', text: 'dunia yang indah', style: { italic: true } },
      ],
    };

    // Range [2, 10]: slices "lo " from run 1 and "dunia" from run 2
    const updated = sliceParagraphRange(paragraph, 2, 10, { bold: true });

    expect(getParagraphText(updated)).toBe('Halo dunia yang indah');

    // Segment 1: "Ha" [0..2] -> color: #000000
    expect(updated.children[0]?.text).toBe('Ha');
    expect(updated.children[0]?.style?.color).toBe('#000000');
    expect(updated.children[0]?.style?.bold).toBeFalsy();

    // Segment 2: "lo " [2..5] -> color: #000000, bold: true
    expect(updated.children[1]?.text).toBe('lo ');
    expect(updated.children[1]?.style?.color).toBe('#000000');
    expect(updated.children[1]?.style?.bold).toBe(true);

    // Segment 3: "dunia" [5..10] -> italic: true, bold: true
    expect(updated.children[2]?.text).toBe('dunia');
    expect(updated.children[2]?.style?.italic).toBe(true);
    expect(updated.children[2]?.style?.bold).toBe(true);

    // Segment 4: " yang indah" [10..21] -> italic: true
    expect(updated.children[3]?.text).toBe(' yang indah');
    expect(updated.children[3]?.style?.italic).toBe(true);
    expect(updated.children[3]?.style?.bold).toBeFalsy();
  });

  it('should serialize sliced paragraph into valid WordprocessingML XML with xml:space preserve', () => {
    const paragraph: ParagraphNode = {
      type: 'paragraph',
      children: [
        { type: 'run', text: 'Halo dunia yang indah' },
      ],
    };

    const sliced = sliceParagraphRange(paragraph, 5, 10, { bold: true });

    const doc: DocumentNode = {
      type: 'document',
      sections: [
        {
          type: 'section',
          properties: {
            pageSize: { width: 612, height: 792 },
            margins: { top: 72, right: 72, bottom: 72, left: 72 },
          },
          children: [sliced],
        },
      ],
    };

    const xml = wmlBuilder.buildDocumentXml(doc);

    // Verify XML contains 3 runs, bold tag on 'dunia', and preserve space on surrounding runs
    expect(xml).toContain('<w:t xml:space="preserve">Halo </w:t>');
    expect(xml).toContain('<w:b/>');
    expect(xml).toContain('<w:t>dunia</w:t>');
    expect(xml).toContain('<w:t xml:space="preserve"> yang indah</w:t>');
  });
});
