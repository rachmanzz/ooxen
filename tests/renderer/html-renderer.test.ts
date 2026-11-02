import { describe, expect, it } from 'bun:test';
import { defaultXmlAdapter } from '../../src/parser/xml-adapter.js';
import { StandardHtmlRenderer } from '../../src/renderer/html/html-renderer.js';
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
});
