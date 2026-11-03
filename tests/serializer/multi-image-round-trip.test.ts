import { describe, expect, it } from 'bun:test';
import { openPackage } from '../../src/opc/package.js';
import { exportOoxml } from '../../src/serializer/ooxen-writer.js';
import type { DocumentNode, ImageNode, ParagraphNode } from '../../src/types/ast.js';

// Regression tests for v2 findings N1 (media partName collision) and N2
// (relationship id collision with the builder's hardcoded ids). Images carry
// preset relationship ids exactly like those produced by parsing a real
// Word-produced .docx.
const pngA = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0a]);
const pngB = new Uint8Array([0x60, 0x0d, 0x0a, 0x1a, 0x0b]);

function imageWith(relId: string, data: Uint8Array, name: string): ImageNode {
  return {
    type: 'image',
    name,
    altText: name,
    widthPt: 50,
    heightPt: 50,
    data,
    mimeType: 'image/png',
    relationshipId: relId,
  };
}

describe('Multi-image package integrity (v2 N1/N2)', () => {
  it('keeps every image with a preset relationship id and preserves styles/numbering rels', async () => {
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
              // numPr triggers word/numbering.xml + its relationship
              style: { numbering: { numId: 1, level: 0 } },
              children: [
                { type: 'run', text: 'a', image: imageWith('rId2', pngA, 'a.png') },
                { type: 'run', text: 'b', image: imageWith('rId3', pngB, 'b.png') },
              ],
            },
          ],
        },
      ],
    };

    const docx = await exportOoxml(doc);
    const pkg = await openPackage(docx);

    // N1: each image gets its own media part — no overwrites.
    const partA = pkg.getPart('word/media/image1.png');
    const partB = pkg.getPart('word/media/image2.png');
    expect(partA).toBeDefined();
    expect(partB).toBeDefined();
    expect(Array.from(partA!.data)).toEqual(Array.from(pngA));
    expect(Array.from(partB!.data)).toEqual(Array.from(pngB));

    // N2: styles and numbering relationships must survive next to the image
    // relationships (no id-dedup clobbering).
    const rels = pkg.getRelationships('word/document.xml');
    const ids = rels.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(rels.find((r) => r.type.endsWith('/styles'))?.target).toBe('styles.xml');
    expect(rels.find((r) => r.type.endsWith('/numbering'))?.target).toBe('numbering.xml');
    const imageRels = rels.filter((r) => r.type.endsWith('/image'));
    expect(imageRels.length).toBe(2);
    expect(new Set(imageRels.map((r) => r.target)).size).toBe(2);
  });

  it('does not mutate the caller document when exporting (v2 N11)', async () => {
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
              children: [{ type: 'run', text: 'a', image: imageWith('rIdX', pngA, 'a.png') }],
            },
          ],
        },
      ],
    };

    await exportOoxml(doc);
    const paragraph = doc.sections[0]?.children[0] as ParagraphNode | undefined;
    expect(paragraph?.children[0]?.image?.relationshipId).toBe('rIdX');
  });
});
