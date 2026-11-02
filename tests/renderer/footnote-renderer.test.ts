import { describe, expect, it } from 'bun:test';
import { defaultPageEngine } from '../../src/layout/page-engine.js';
import { openDocument } from '../../src/parser/wml/document-parser.js';
import { StandardHtmlRenderer } from '../../src/renderer/html/html-renderer.js';
import { StandardPageRenderer } from '../../src/renderer/canvas/page-renderer.js';
import type { CanvasTarget } from '../../src/renderer/canvas/canvas-target.js';
import { exportOoxmlFromHtml } from '../../src/serializer/ooxen-writer.js';
import type { DocumentNode } from '../../src/types/ast.js';

class MockCanvasTarget implements CanvasTarget {
  calls: { method: string; args: any[] }[] = [];

  fillRect(x: number, y: number, w: number, h: number): void {
    this.calls.push({ method: 'fillRect', args: [x, y, w, h] });
  }
  strokeRect(x: number, y: number, w: number, h: number): void {
    this.calls.push({ method: 'strokeRect', args: [x, y, w, h] });
  }
  fillText(text: string, x: number, y: number): void {
    this.calls.push({ method: 'fillText', args: [text, x, y] });
  }
  beginPath(): void {
    this.calls.push({ method: 'beginPath', args: [] });
  }
  moveTo(x: number, y: number): void {
    this.calls.push({ method: 'moveTo', args: [x, y] });
  }
  lineTo(x: number, y: number): void {
    this.calls.push({ method: 'lineTo', args: [x, y] });
  }
  bezierCurveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number): void {
    this.calls.push({ method: 'bezierCurveTo', args: [cp1x, cp1y, cp2x, cp2y, x, y] });
  }
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void {
    this.calls.push({ method: 'quadraticCurveTo', args: [cpx, cpy, x, y] });
  }
  closePath(): void {
    this.calls.push({ method: 'closePath', args: [] });
  }
  fill(): void {
    this.calls.push({ method: 'fill', args: [] });
  }
  stroke(): void {
    this.calls.push({ method: 'stroke', args: [] });
  }
  drawImage(image: any, dx: number, dy: number, dw?: number, dh?: number): void {
    this.calls.push({ method: 'drawImage', args: [image, dx, dy, dw, dh] });
  }
  save(): void {
    this.calls.push({ method: 'save', args: [] });
  }
  restore(): void {
    this.calls.push({ method: 'restore', args: [] });
  }
}

describe('Footnote Layout, Canvas & HTML Renderer', () => {
  const htmlRenderer = new StandardHtmlRenderer();
  const pageRenderer = new StandardPageRenderer();

  const testDoc: DocumentNode = {
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
            children: [
              { type: 'run', text: 'Statement requiring citation' },
              { type: 'run', text: '[1]', footnoteRef: { id: 1, kind: 'footnote' } },
            ],
          },
        ],
      },
    ],
    footnotes: [
      {
        type: 'footnote',
        kind: 'footnote',
        id: 1,
        children: [
          {
            type: 'paragraph',
            children: [
              { type: 'run', text: '[1] ', isFootnoteRefMark: true },
              { type: 'run', text: 'Detailed reference at bottom of page.' },
            ],
          },
        ],
      },
    ],
  };

  it('should layout footnote at page bottom and render separator rule on canvas', () => {
    const pages = defaultPageEngine.layoutDocument(testDoc);
    expect(pages.length).toBe(1);

    const page = pages[0]!;
    expect(page.footnoteLines).toBeDefined();
    expect(page.footnoteLines?.length).toBeGreaterThan(0);

    // Verify footnote Y position is at bottom of page content area
    const fnLine = page.footnoteLines![0]!;
    expect(fnLine.bounds.y).toBeGreaterThan(600); // Near bottom of 792pt page

    // Render to CanvasTarget
    const target = new MockCanvasTarget();
    pageRenderer.renderPage(page, target);

    // Verify text draw calls include footnote text
    const allText = target.calls
      .filter((c) => c.method === 'fillText')
      .map((c) => c.args[0])
      .join('')
      .replace(/\s+/g, ' ');
    expect(allText).toContain('Detailed reference');

    // Verify separator rect draw call
    const hasSeparator = target.calls.some(
      (c) => c.method === 'fillRect' && c.args[2] === 100, // width: 100 pt
    );
    expect(hasSeparator).toBe(true);
  });

  it('should render HTML with <sup> citation and <aside class="ooxen-footnotes">', () => {
    const html = htmlRenderer.renderToHtmlString(testDoc);

    expect(html).toContain('<sup class="ooxen-footnote-ref"><a href="#fn-1">[1]</a></sup>');
    expect(html).toContain('<aside class="ooxen-footnotes">');
    expect(html).toContain('<hr class="ooxen-footnote-separator" />');
    expect(html).toContain('<li id="fn-1">');
    expect(html).toContain('Detailed reference at bottom of page.');
  });

  it('should round-trip HTML with footnotes -> OOXML -> Document AST -> HTML', async () => {
    const initialHtml = `<html xmlns="http://www.w3.org/1999/xhtml">
  <body>
    <article class="ooxen-document">
      <section class="ooxen-section">
        <p class="ooxen-p">
          <span class="ooxen-r">Academic research finding</span>
          <sup class="ooxen-footnote-ref"><a href="#fn-1">[1]</a></sup>
        </p>
      </section>
      <aside class="ooxen-footnotes">
        <hr class="ooxen-footnote-separator" />
        <ol>
          <li id="fn-1">
            <p class="ooxen-p"><span class="ooxen-r">Journal citation 2026.</span></p>
          </li>
        </ol>
      </aside>
    </article>
  </body>
</html>`;

    // 1. Export HTML with footnotes directly to OOXML (.docx)
    const docxBytes = await exportOoxmlFromHtml(initialHtml);
    expect(docxBytes.length).toBeGreaterThan(0);

    // 2. Open back into Document AST
    const recoveredDoc = await openDocument(docxBytes);
    expect(recoveredDoc.footnotes).toBeDefined();
    expect(recoveredDoc.footnotes?.length).toBeGreaterThanOrEqual(1);

    const fn = recoveredDoc.footnotes?.find((f) => f.id === 1);
    expect(fn).toBeDefined();
    expect(fn?.children[0]?.type).toBe('paragraph');

    // 3. Render recovered AST back to HTML
    const reHtml = htmlRenderer.renderToHtmlString(recoveredDoc);
    expect(reHtml).toContain('<sup class="ooxen-footnote-ref"><a href="#fn-1">[1]</a></sup>');
    expect(reHtml).toContain('<aside class="ooxen-footnotes">');
    expect(reHtml).toContain('Journal citation 2026.');
  });
});
