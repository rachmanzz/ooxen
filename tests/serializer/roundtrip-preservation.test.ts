import { describe, expect, it } from 'bun:test';
import { openPackage } from '../../src/opc/package.js';
import { exportOoxml } from '../../src/serializer/ooxen-writer.js';
import { openDocument } from '../../src/parser/wml/document-parser.js';
import type { DocumentNode } from '../../src/types/ast.js';

// Regression tests for audit findings F-STYLELOSS (custom styles/numbering
// dropped on write) and F-NUMDANGLE (dangling refs for numId >= 3).
function sectionWith(text: string, numbering?: { numId: number; level: number; format?: string }): DocumentNode {
  return {
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
            style: numbering ? { numbering } : undefined,
            children: [{ type: 'run', text }],
          },
        ],
      },
    ],
  };
}

const partText = async (bytes: Uint8Array, name: string): Promise<string> => {
  const part = (await openPackage(bytes)).getPart(name);
  expect(part).toBeDefined();
  return new TextDecoder().decode(part!.data);
};

describe('Round-trip preservation (F-STYLELOSS, F-NUMDANGLE)', () => {
  it('preserves a parsed custom styles.xml verbatim', async () => {
    const custom = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:styleId="CustomMarker"/></w:styles>';
    const doc = sectionWith('hello');
    doc.customStylesXml = custom;
    const bytes = await exportOoxml(doc);
    expect(await partText(bytes, 'word/styles.xml')).toBe(custom);
  });

  it('preserves a parsed custom numbering.xml verbatim', async () => {
    const custom = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:num w:numId="9"><w:abstractNumId w:val="9"/></w:num></w:numbering>';
    const doc = sectionWith('hello');
    doc.customNumberingXml = custom;
    const bytes = await exportOoxml(doc);
    expect(await partText(bytes, 'word/numbering.xml')).toBe(custom);
  });

  it('synthesizes definitions for referenced numIds beyond the built-in 1/2', async () => {
    const doc = sectionWith('item', { numId: 5, level: 0, format: 'decimal' });
    const bytes = await exportOoxml(doc);
    const xml = await partText(bytes, 'word/numbering.xml');
    expect(xml).toContain('w:numId="5"');
    expect(xml).toContain('w:abstractNumId="1005"');
    // The written package must reopen with numbering intact.
    const reopened = await openDocument(bytes);
    expect(reopened.sections.length).toBe(1);
  });

  it('emits no synthesized defs when only built-in ids are used', async () => {
    const doc = sectionWith('item', { numId: 1, level: 0, format: 'bullet' });
    const bytes = await exportOoxml(doc);
    const xml = await partText(bytes, 'word/numbering.xml');
    expect(xml).not.toContain('Synthesized');
    expect(xml).toContain('w:numId="1"');
  });
});
