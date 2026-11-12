import { describe, expect, it } from 'bun:test';
import { defaultXmlAdapter } from '../../src/parser/xml-adapter.js';
import { StandardHtmlRenderer, renderShapeToSvg } from '../../src/renderer/html/html-renderer.js';
import type { DocumentNode } from '../../src/types/ast.js';

describe('Semantic XML-HTML Renderer', () => {
  const htmlRenderer = new StandardHtmlRenderer();

  it('should render document to strict well-formed XHTML XML', () => {
    const doc: DocumentNode = {
      type: 'document',
      sections: [
        {
          type: 'section',
          properties: {
            pageSize: { width: 595.3, height: 841.9 },
            margins: { top: 72, right: 72, bottom: 72, left: 72 },
          },
          children: [
            {
              type: 'paragraph',
              style: { alignment: 'center', spaceAfterPt: 12 },
              children: [
                {
                  type: 'run',
                  text: 'Document Title',
                  style: { bold: true, fontSizePt: 18, color: '#333333' },
                },
              ],
            },
            {
              type: 'table',
              rows: [
                {
                  type: 'table-row',
                  children: [
                    {
                      type: 'table-cell',
                      colSpan: 2,
                      style: { backgroundColor: '#EEEEEE' },
                      children: [
                        {
                          type: 'paragraph',
                          children: [{ type: 'run', text: 'Merged Cell' }],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    const xhtml = htmlRenderer.renderToHtmlString(doc);

    // 1. String checks
    expect(xhtml).toContain('<article class="ooxen-document"');
    expect(xhtml).toContain('<section class="ooxen-section"');
    expect(xhtml).toContain('<p class="ooxen-p"');
    expect(xhtml).toContain('<span class="ooxen-r"');
    expect(xhtml).toContain('Document Title');
    expect(xhtml).toContain('<table class="ooxen-table"');
    expect(xhtml).toContain('colspan="2"');

    // 2. Strict XML well-formedness verification
    const parsedXml = defaultXmlAdapter.parse(xhtml);
    expect(parsedXml).toBeDefined();
    expect(parsedXml.nodeName).toBe('article');
    expect(parsedXml.children.length).toBe(1);
    expect(parsedXml.children[0]?.nodeName).toBe('section');
  });

  it('renders WMF equation previews through their SVG form (F-WMFEQ)', () => {
    const u16 = (v: number): number[] => [v & 0xff, (v >> 8) & 0xff];
    const bytes = [
      0xd7, 0xcd, 0xc6, 0x9a, 0x00, 0x00,
      ...u16(0), ...u16(0), ...u16(1000), ...u16(1000),
      ...u16(1440), 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x08, 0x00, 0x00, 0x00, 0x32, 0x0a,
      ...u16(100), ...u16(100), ...u16(2), ...u16(0),
      0x48, 0x69,
    ];
    const doc: DocumentNode = {
      type: 'document',
      sections: [
        {
          type: 'section',
          properties: {
            pageSize: { width: 595.3, height: 841.9 },
            margins: { top: 72, right: 72, bottom: 72, left: 72 },
          },
          children: [
            {
              type: 'paragraph',
              children: [
                {
                  type: 'run',
                  text: '',
                  image: {
                    type: 'image',
                    widthPt: 46,
                    heightPt: 31,
                    data: new Uint8Array(bytes),
                    mimeType: 'image/x-wmf',
                    relationshipId: 'rId2',
                  },
                },
              ],
            },
          ],
        },
      ],
    };
    const xhtml = htmlRenderer.renderToHtmlString(doc);
    expect(xhtml).toContain('data:image/svg+xml');
    expect(xhtml).not.toContain('data:image/x-wmf');
  });

  it('draws textbox text inside the SVG only for floating shapes (F-TBXFLOAT)', () => {
    const textbox = [{ type: 'paragraph' as const, children: [{ type: 'run' as const, text: 'Figure 1' }] }];
    const base = {
      type: 'drawing' as const,
      name: 'Box',
      widthPt: 100,
      heightPt: 40,
      commands: [],
      textbox,
    };
    // Inline shapes already drained their paragraphs into the flow on
    // parse, so the SVG must not print the text a second time.
    expect(renderShapeToSvg(base)).not.toContain('<text');
    const floating = {
      ...base,
      anchor: { horizontalFrom: 'column', horizontalOffsetPt: 0, verticalFrom: 'paragraph', verticalOffsetPt: 0 },
    };
    expect(renderShapeToSvg(floating)).toContain('Figure 1');
  });

  it('positions floating shapes like floating images (F-HTMLFLOAT)', () => {
    const doc: DocumentNode = {
      type: 'document',
      sections: [
        {
          type: 'section',
          properties: { pageSize: { width: 612, height: 792 }, margins: { top: 72, right: 72, bottom: 72, left: 72 } },
          children: [
            {
              type: 'paragraph',
              children: [
                { type: 'run', text: 'Body' },
                {
                  type: 'run',
                  text: '',
                  drawing: {
                    type: 'drawing',
                    name: 'Banner',
                    widthPt: 200,
                    heightPt: 30,
                    commands: [],
                    anchor: { horizontalFrom: 'column', horizontalOffsetPt: 24, verticalFrom: 'paragraph', verticalOffsetPt: 6 },
                  },
                },
              ],
            },
          ],
        },
      ],
    };
    const xhtml = htmlRenderer.renderToHtmlString(doc);
    expect(xhtml).toContain('ooxen-has-float');
    expect(xhtml).toMatch(/<svg class="ooxen-shape ooxen-float"[^>]*style="position: absolute; left: 24pt; top: 6pt;"/);
  });

  it('wraps and aligns floating textbox text through the line breaker (F-TBXFLOAT)', () => {
    const floating = {
      type: 'drawing' as const,
      name: 'Callout',
      widthPt: 120,
      heightPt: 80,
      commands: [],
      anchor: { horizontalFrom: 'column', horizontalOffsetPt: 0, verticalFrom: 'paragraph', verticalOffsetPt: 0 },
    };
    const long = 'This callout holds a sentence that is far too long for one line of the box.';
    const wrapped = renderShapeToSvg({
      ...floating,
      textbox: [{ type: 'paragraph', children: [{ type: 'run', text: long }] }],
    });
    const ys = [...wrapped.matchAll(/<text x="[^"]+" y="([^"]+)"/g)].map((m) => Number(m[1]));
    expect(new Set(ys).size).toBeGreaterThan(1);
    expect(Math.max(...ys)).toBeLessThan(80);
    expect(wrapped).not.toContain('text-anchor="middle"');

    const right = renderShapeToSvg({
      ...floating,
      textbox: [{ type: 'paragraph', style: { alignment: 'right' }, children: [{ type: 'run', text: 'End' }] }],
    });
    const x = Number(/<text x="([^"]+)"/.exec(right)![1]);
    expect(x).toBeGreaterThan(60);
  });
});
