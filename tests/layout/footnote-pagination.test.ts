import { describe, expect, it } from 'bun:test';
import { StandardPageEngine } from '../../src/layout/page-engine.js';
import type { BlockNode, DocumentNode, ParagraphNode } from '../../src/types/ast.js';

const PAGE = { width: 612, height: 792 };
const MARGINS = { top: 72, right: 72, bottom: 72, left: 72 };
const CONTENT_BOTTOM = PAGE.height - MARGINS.bottom; // 720

const bodyPara = (text: string): ParagraphNode => ({
  type: 'paragraph',
  children: [{ type: 'run', text }],
});

function docWithFootnoteRefs(body: BlockNode[], footnoteBody: BlockNode[]): DocumentNode {
  return {
    type: 'document',
    sections: [
      {
        type: 'section',
        properties: { pageSize: { ...PAGE }, margins: { ...MARGINS } },
        children: body,
      },
    ],
    footnotes: [{ type: 'footnote', kind: 'footnote', id: 1, children: footnoteBody }],
  };
}

const lineBottom = (l: { bounds: { y: number; height: number } }): number => l.bounds.y + l.bounds.height;

describe('Footnote pagination and body-space reservation (F-FNOTE-PAG)', () => {
  it('reserves body space so body lines never overlap the footnote zone', () => {
    // A full page of body with the ref in the middle: the ref page must
    // carry the footnote below the body instead of overlaying it.
    const body: BlockNode[] = [];
    for (let i = 0; i < 59; i++) {
      if (i === 50) {
        body.push({
          type: 'paragraph',
          children: [
            { type: 'run', text: 'Middle body line with citation' },
            { type: 'run', text: '[1]', footnoteRef: { id: 1, kind: 'footnote' } },
          ],
        });
      } else {
        body.push(bodyPara(`Body line number ${i} with filler words to wrap normally.`));
      }
    }

    const doc = docWithFootnoteRefs(body, [
      bodyPara('Footnote text that must sit below the body without overlapping it, long enough to wrap a second line.'),
    ]);
    const pages = new StandardPageEngine().layoutDocument(doc);

    const refPage = pages.find((p) =>
      p.lines.some((l) => l.fragments.some((f) => f.footnoteRef?.id === 1)),
    );
    expect(refPage).toBeDefined();
    expect(refPage!.footnoteLines?.length).toBeGreaterThan(0);

    const footnoteTop = refPage!.footnoteLines![0]!.bounds.y;
    for (const line of refPage!.lines) {
      expect(lineBottom(line)).toBeLessThanOrEqual(footnoteTop - 6); // separator gap
    }
    const footnoteBottom = Math.max(...refPage!.footnoteLines!.map(lineBottom));
    expect(footnoteBottom).toBeLessThanOrEqual(CONTENT_BOTTOM);
  });

  it('splits an oversized footnote across pages instead of overflowing', () => {
    const footnoteBody: BlockNode[] = [];
    for (let i = 0; i < 60; i++) footnoteBody.push(bodyPara(`Footnote continued line ${i} with filler words.`));

    const doc = docWithFootnoteRefs(
      [
        {
          type: 'paragraph',
          children: [
            { type: 'run', text: 'Cited statement' },
            { type: 'run', text: '[1]', footnoteRef: { id: 1, kind: 'footnote' } },
          ],
        },
      ],
      footnoteBody,
    );
    const pages = new StandardPageEngine().layoutDocument(doc);

    const allFootnoteLines = pages.flatMap((p) => p.footnoteLines ?? []);
    expect(allFootnoteLines.length).toBeGreaterThanOrEqual(60);
    const pagesWithFootnotes = pages.filter((p) => (p.footnoteLines?.length ?? 0) > 0);
    expect(pagesWithFootnotes.length).toBeGreaterThan(1);

    // No footnote line may run past the content area, and body must stay clear.
    for (const page of pagesWithFootnotes) {
      const bottom = page.size.height - page.margins.bottom;
      for (const line of page.footnoteLines!) {
        expect(line.bounds.y).toBeGreaterThanOrEqual(page.margins.top);
        expect(lineBottom(line)).toBeLessThanOrEqual(bottom);
      }
      const footnoteTop = page.footnoteLines![0]!.bounds.y;
      for (const line of page.lines) {
        expect(lineBottom(line)).toBeLessThanOrEqual(footnoteTop);
      }
    }
  });
});
