import { describe, expect, it } from 'bun:test';
import { defaultXmlAdapter } from '../../src/parser/xml-adapter.js';
import { openDocument } from '../../src/parser/wml/document-parser.js';
import { StandardHtmlRenderer } from '../../src/renderer/html/html-renderer.js';
import { exportOoxmlFromHtml } from '../../src/serializer/ooxen-writer.js';
import type { DocumentNode } from '../../src/types/ast.js';

describe('Metadata HTML Renderer & XHTML Round-Trip', () => {
  const htmlRenderer = new StandardHtmlRenderer();

  it('should render <head> with <title> and <meta> tags when metadata is present', () => {
    const doc: DocumentNode = {
      type: 'document',
      metadata: {
        title: 'HTML Metadata Spec',
        creator: 'Muhammad Abdurrahman',
        description: 'Testing HTML metadata tags',
        keywords: ['spec', 'html', 'docx'],
        subject: 'Engineering',
        application: 'Ooxen Renderer',
      },
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
              children: [{ type: 'run', text: 'Hello World from HTML renderer.' }],
            },
          ],
        },
      ],
    };

    const xhtml = htmlRenderer.renderToHtmlString(doc);

    // 1. Structure checks
    expect(xhtml).toContain('<html xmlns="http://www.w3.org/1999/xhtml">');
    expect(xhtml).toContain('<head>');
    expect(xhtml).toContain('<title>HTML Metadata Spec</title>');
    expect(xhtml).toContain('<meta name="author" content="Muhammad Abdurrahman" />');
    expect(xhtml).toContain('<meta name="description" content="Testing HTML metadata tags" />');
    expect(xhtml).toContain('<meta name="keywords" content="spec, html, docx" />');
    expect(xhtml).toContain('<meta name="subject" content="Engineering" />');
    expect(xhtml).toContain('<meta name="generator" content="Ooxen Renderer" />');
    expect(xhtml).toContain('<article class="ooxen-document"');
    expect(xhtml).toContain('Hello World from HTML renderer.');

    // 2. Strict XML well-formedness
    const parsedXml = defaultXmlAdapter.parse(xhtml);
    expect(parsedXml).toBeDefined();
    expect(parsedXml.nodeName.toLowerCase().endsWith('html')).toBe(true);
  });

  it('should render clean <article> without <head> when metadata is omitted', () => {
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
              children: [{ type: 'run', text: 'Clean document without metadata' }],
            },
          ],
        },
      ],
    };

    const xhtml = htmlRenderer.renderToHtmlString(doc);
    expect(xhtml.startsWith('<article class="ooxen-document"')).toBe(true);
    expect(xhtml).not.toContain('<head>');
  });

  it('should round-trip HTML with metadata -> OOXML (.docx) -> Document AST -> HTML', async () => {
    const initialHtml = `<html xmlns="http://www.w3.org/1999/xhtml">
  <head>
    <title>Round-Trip Document</title>
    <meta name="author" content="Abdurrahman" />
    <meta name="description" content="Bidirectional HTML-OOXML metadata flow" />
    <meta name="keywords" content="html, ooxml, roundtrip" />
  </head>
  <body>
    <article class="ooxen-document">
      <section class="ooxen-section">
        <p class="ooxen-p"><span class="ooxen-r">Testing Bidirectional Flow</span></p>
      </section>
    </article>
  </body>
</html>`;

    // 1. Export HTML directly to OOXML (.docx) Uint8Array
    const docxBytes = await exportOoxmlFromHtml(initialHtml);
    expect(docxBytes.length).toBeGreaterThan(0);

    // 2. Open document package into AST
    const recoveredDoc = await openDocument(docxBytes);
    expect(recoveredDoc.metadata).toBeDefined();
    expect(recoveredDoc.metadata?.title).toBe('Round-Trip Document');
    expect(recoveredDoc.metadata?.creator).toBe('Abdurrahman');
    expect(recoveredDoc.metadata?.description).toBe('Bidirectional HTML-OOXML metadata flow');
    expect(recoveredDoc.metadata?.keywords).toEqual(['html', 'ooxml', 'roundtrip']);

    // 3. Render recovered AST back to HTML and verify metadata tags are present
    const reRenderedHtml = htmlRenderer.renderToHtmlString(recoveredDoc);
    expect(reRenderedHtml).toContain('<title>Round-Trip Document</title>');
    expect(reRenderedHtml).toContain('<meta name="author" content="Abdurrahman" />');
    expect(reRenderedHtml).toContain('<meta name="description" content="Bidirectional HTML-OOXML metadata flow" />');
    expect(reRenderedHtml).toContain('<meta name="keywords" content="html, ooxml, roundtrip" />');
    expect(reRenderedHtml).toContain('Testing Bidirectional Flow');
  });
});
