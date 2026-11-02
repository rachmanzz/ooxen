import { describe, expect, it } from 'bun:test';
import { defaultHtmlRenderer } from '../../src/renderer/html/html-renderer.js';
import { defaultOoxenWriter } from '../../src/serializer/ooxen-writer.js';
import { defaultWmlBuilder } from '../../src/serializer/wml-builder.js';
import type { DocumentNode } from '../../src/types/ast.js';

describe('Multi-Column Section Serializer & Round-trip', () => {
  it('should serialize w:cols with count, space, and separator into WordprocessingML', () => {
    const doc: DocumentNode = {
      type: 'document',
      sections: [
        {
          type: 'section',
          properties: {
            pageSize: { width: 612, height: 792 },
            margins: { top: 72, right: 72, bottom: 72, left: 72 },
            columns: {
              count: 3,
              spacePt: 18,
              separator: true,
            },
          },
          children: [
            {
              type: 'paragraph',
              children: [{ type: 'run', text: 'Three columns section content' }],
            },
          ],
        },
      ],
    };

    const wml = defaultWmlBuilder.buildDocumentXml(doc);
    expect(wml).toContain('<w:cols w:num="3" w:space="360" w:sep="1"/>'); // 18 pt = 360 twips
  });

  it('should render CSS multi-column styles in HTML', () => {
    const doc: DocumentNode = {
      type: 'document',
      sections: [
        {
          type: 'section',
          properties: {
            pageSize: { width: 612, height: 792 },
            margins: { top: 72, right: 72, bottom: 72, left: 72 },
            columns: {
              count: 2,
              spacePt: 24,
              separator: true,
            },
          },
          children: [
            {
              type: 'paragraph',
              children: [{ type: 'run', text: 'Newspaper article content' }],
            },
          ],
        },
      ],
    };

    const html = defaultHtmlRenderer.renderToHtmlString(doc);
    expect(html).toContain('column-count: 2');
    expect(html).toContain('column-gap: 24pt');
    expect(html).toContain('column-rule: 1px solid #CCCCCC');
  });

  it('should round-trip HTML multi-column styles into OOXML .docx', async () => {
    const html = `
<article class="ooxen-document">
  <section class="ooxen-section" style="column-count: 2; column-gap: 36pt; column-rule: 1px solid #ccc;">
    <p class="ooxen-p"><span class="ooxen-r">Column text</span></p>
  </section>
</article>`;

    const docxBytes = await defaultOoxenWriter.writeFromHtml(html);
    expect(docxBytes).toBeInstanceOf(Uint8Array);
    expect(docxBytes.length).toBeGreaterThan(100);
  });
});
