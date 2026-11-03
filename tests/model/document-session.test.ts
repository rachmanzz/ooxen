import { describe, expect, it } from 'bun:test';
import { createDocumentSession } from '../../src/model/document-session.js';
import type { DocumentNode, ParagraphNode } from '../../src/types/ast.js';

describe('DocumentSession Plain Object API', () => {
  const initialDoc: DocumentNode = {
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
            children: [{ type: 'run', text: 'Halo dunia yang indah' }],
          },
        ],
      },
    ],
  };

  it('should initialize plain session object with pages and methods', () => {
    const session = createDocumentSession(initialDoc);

    // Verify it is a plain object with properties
    expect(session.document).toBe(initialDoc);
    expect(session.pages.length).toBe(1);
    expect(typeof session.hitTest).toBe('function');
    expect(typeof session.applyRangeStyle).toBe('function');
    expect(typeof session.renderPage).toBe('function');
    expect(typeof session.toOoxml).toBe('function');
    expect(typeof session.toHtml).toBe('function');
  });

  it('should perform hit-testing on the page layout', () => {
    const session = createDocumentSession(initialDoc);

    // Hit-test on first word 'Halo' (x = 80 is within margin 72 + 'Halo' width)
    const hitHalo = session.hitTest(80, 80);
    expect(hitHalo).toBeDefined();
    expect(hitHalo?.lineIndex).toBe(0);
    expect(hitHalo?.text).toBe('Halo');

    // Hit-test on second word 'dunia' (x = 105 is within 'dunia' fragment)
    const hitDunia = session.hitTest(105, 80);
    expect(hitDunia).toBeDefined();
    expect(hitDunia?.lineIndex).toBe(0);
    expect(hitDunia?.text).toBe('dunia');
  });

  it('should immutably slice paragraph and apply style via applyRangeStyle', async () => {
    const session1 = createDocumentSession(initialDoc);

    // Slice "dunia" at [5, 10] and apply bold
    const session2 = session1.applyRangeStyle(0, 5, 10, { bold: true });

    // Session 1 remains pristine (immutable)
    const p1 = session1.document.sections[0]!.children[0] as ParagraphNode;
    expect(p1.children.length).toBe(1);
    expect(p1.children[0]?.style?.bold).toBeFalsy();

    // Session 2 has 3 sliced runs with bold in middle
    const p2 = session2.document.sections[0]!.children[0] as ParagraphNode;
    expect(p2.children.length).toBe(3);
    expect(p2.children[0]?.text).toBe('Halo ');
    expect(p2.children[1]?.text).toBe('dunia');
    expect(p2.children[1]?.style?.bold).toBe(true);
    expect(p2.children[2]?.text).toBe(' yang indah');

    // Export to HTML and OOXML directly from plain object session
    const html = session2.toHtml();
    expect(html).toContain('font-weight: bold;');
    expect(html).toContain('dunia');

    const ooxmlBytes = await session2.toOoxml();
    expect(ooxmlBytes).toBeInstanceOf(Uint8Array);
    expect(ooxmlBytes.length).toBeGreaterThan(0);
  });
});
