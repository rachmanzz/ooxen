import { describe, expect, it } from 'bun:test';
import { hostBlockFloats, hostDocumentBlockFloats } from '../../src/types/block-floats.js';
import type { BlockNode, DocumentNode, DrawingShapeNode } from '../../src/types/ast.js';

const anchored: DrawingShapeNode = {
  type: 'drawing',
  name: 'Banner',
  widthPt: 100,
  heightPt: 20,
  commands: [],
  anchor: { horizontalFrom: 'column', horizontalOffsetPt: 0, verticalFrom: 'paragraph', verticalOffsetPt: 0 },
};
const inline: DrawingShapeNode = { ...anchored, anchor: undefined };
const para: BlockNode = { type: 'paragraph', children: [{ type: 'run', text: 'text' }] };

describe('Block-level float hosting (F-HTMLFLOAT)', () => {
  it('wraps anchored block drawings and images in an empty host paragraph, leaving the rest alone', () => {
    const image: BlockNode = {
      type: 'image',
      src: '',
      widthPt: 10,
      heightPt: 10,
      anchor: { horizontalFrom: 'page', horizontalOffsetPt: 0, verticalFrom: 'page', verticalOffsetPt: 0 },
    };
    const out = hostBlockFloats([para, anchored, inline, image]);
    expect(out[0]).toBe(para);
    expect(out[1]).toEqual({ type: 'paragraph', children: [{ type: 'run', text: '', drawing: anchored }] });
    expect(out[2]).toBe(inline);
    expect(out[3]).toEqual({ type: 'paragraph', children: [{ type: 'run', text: '', image }] });
  });

  it('returns the same arrays and nodes when nothing needs hosting', () => {
    const blocks: BlockNode[] = [para, inline, { type: 'table', rows: [{ type: 'table-row', children: [{ type: 'table-cell', children: [para] }] }] }];
    expect(hostBlockFloats(blocks)).toBe(blocks);
    const doc: DocumentNode = {
      type: 'document',
      sections: [{ type: 'section', properties: { pageSize: { width: 612, height: 792 }, margins: { top: 72, right: 72, bottom: 72, left: 72 } }, children: blocks }],
    };
    expect(hostDocumentBlockFloats(doc)).toBe(doc);
  });

  it('reaches nested table cells, headers, footers, footnotes, and comments, copying only the changed path', () => {
    const untouchedSection = {
      type: 'section' as const,
      properties: { pageSize: { width: 612, height: 792 }, margins: { top: 72, right: 72, bottom: 72, left: 72 } },
      children: [para],
    };
    const doc: DocumentNode = {
      type: 'document',
      sections: [
        untouchedSection,
        {
          ...untouchedSection,
          children: [
            {
              type: 'table',
              rows: [
                { type: 'table-row', children: [{ type: 'table-cell', children: [para] }] },
                {
                  type: 'table-row',
                  children: [
                    {
                      type: 'table-cell',
                      children: [{ type: 'table', rows: [{ type: 'table-row', children: [{ type: 'table-cell', children: [anchored] }] }] }],
                    },
                  ],
                },
              ],
            },
          ],
          headers: { default: { type: 'header', kind: 'default', children: [anchored] }, first: { type: 'header', kind: 'first', children: [para] } },
          footers: { default: { type: 'footer', kind: 'default', children: [para] } },
        },
      ],
      footnotes: [{ type: 'footnote', id: 1, kind: 'footnote', children: [anchored] }],
      comments: [{ type: 'comment', id: 'c1', children: [anchored] }],
    };
    const out = hostDocumentBlockFloats(doc);
    expect(out).not.toBe(doc);
    expect(out.sections[0]).toBe(doc.sections[0]);
    const section = out.sections[1]!;
    const table = section.children[0]!;
    if (table.type !== 'table') throw new Error('table expected');
    expect(table.rows[0]).toBe((doc.sections[1]!.children[0] as typeof table).rows[0]);
    const nested = table.rows[1]!.children[0]!.children[0]!;
    if (nested.type !== 'table') throw new Error('nested table expected');
    expect(nested.rows[0]!.children[0]!.children[0]!.type).toBe('paragraph');
    expect(section.headers!.default!.children[0]!.type).toBe('paragraph');
    expect(section.headers!.first).toBe(doc.sections[1]!.headers!.first);
    expect(section.footers).toBe(doc.sections[1]!.footers);
    expect(out.footnotes![0]!.children[0]!.type).toBe('paragraph');
    expect(out.comments![0]!.children[0]!.type).toBe('paragraph');
  });
});
