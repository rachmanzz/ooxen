import { describe, expect, it } from 'bun:test';
import { StandardPageEngine } from '../../src/layout/page-engine.js';
import type { CanvasTarget } from '../../src/renderer/canvas/canvas-target.js';
import { StandardPageRenderer } from '../../src/renderer/canvas/page-renderer.js';
import { StandardHtmlRenderer } from '../../src/renderer/html/html-renderer.js';
import type { DocumentNode } from '../../src/types/ast.js';

class MockCanvasTarget implements CanvasTarget {
  calls: { method: string; args: any[] }[] = [];
  fillStyle = '#000000';
  strokeStyle = '#000000';
  lineWidth = 1;
  font = '12px sans-serif';

  fillRect(x: number, y: number, w: number, h: number): void {
    this.calls.push({ method: 'fillRect', args: [x, y, w, h] });
  }

  strokeRect(x: number, y: number, w: number, h: number): void {
    this.calls.push({ method: 'strokeRect', args: [x, y, w, h] });
  }

  fillText(text: string, x: number, y: number): void {
    this.calls.push({ method: 'fillText', args: [text, x, y] });
  }

  strokeText(text: string, x: number, y: number): void {
    this.calls.push({ method: 'strokeText', args: [text, x, y] });
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

  save(): void {
    this.calls.push({ method: 'save', args: [] });
  }

  restore(): void {
    this.calls.push({ method: 'restore', args: [] });
  }

  drawImage(image: any, x: number, y: number, w: number, h: number): void {
    this.calls.push({ method: 'drawImage', args: [image, x, y, w, h] });
  }

  translate(): void {}
  scale(): void {}
}

describe('Header & Footer Renderer & Page Engine', () => {
  it('should layout headers and footers with dynamic page numbers across pages', () => {
    const doc: DocumentNode = {
      type: 'document',
      sections: [
        {
          type: 'section',
          properties: {
            pageSize: { width: 400, height: 200 },
            margins: { top: 40, right: 20, bottom: 40, left: 20 },
            headerDistancePt: 15,
            footerDistancePt: 15,
          },
          headers: {
            default: {
              type: 'header',
              kind: 'default',
              children: [
                {
                  type: 'paragraph',
                  children: [{ type: 'run', text: 'Corporate Header' }],
                },
              ],
            },
          },
          footers: {
            default: {
              type: 'footer',
              kind: 'default',
              children: [
                {
                  type: 'paragraph',
                  children: [
                    { type: 'run', text: 'Page ' },
                    { type: 'run', text: '', field: 'PAGE' },
                    { type: 'run', text: ' of ' },
                    { type: 'run', text: '', field: 'NUMPAGES' },
                  ],
                },
              ],
            },
          },
          children: [
            // Enough paragraphs to force pagination across 2 pages
            {
              type: 'paragraph',
              style: { spaceAfterPt: 50 },
              children: [{ type: 'run', text: 'Paragraph One' }],
            },
            {
              type: 'paragraph',
              style: { spaceAfterPt: 50 },
              children: [{ type: 'run', text: 'Paragraph Two' }],
            },
            {
              type: 'paragraph',
              style: { spaceAfterPt: 50 },
              children: [{ type: 'run', text: 'Paragraph Three' }],
            },
          ],
        },
      ],
    };

    const engine = new StandardPageEngine();
    const pages = engine.layoutDocument(doc);

    expect(pages.length).toBeGreaterThanOrEqual(2);

    // Page 1
    const p1 = pages[0]!;
    expect(p1.headerLines).toBeDefined();
    expect(p1.headerLines?.[0]?.fragments.map((f) => f.text).join('')).toBe('Corporate Header');
    expect(p1.footerLines).toBeDefined();

    const p1FooterText = p1.footerLines?.[0]?.fragments.map((f) => f.text).join('');
    expect(p1FooterText).toBe(`Page 1 of ${pages.length}`);

    // Page 2
    const p2 = pages[1]!;
    expect(p2.headerLines).toBeDefined();
    expect(p2.headerLines?.[0]?.fragments.map((f) => f.text).join('')).toBe('Corporate Header');
    expect(p2.footerLines).toBeDefined();

    const p2FooterText = p2.footerLines?.[0]?.fragments.map((f) => f.text).join('');
    expect(p2FooterText).toBe(`Page 2 of ${pages.length}`);
  });

  it('should render header and footer lines onto CanvasTarget', () => {
    const engine = new StandardPageEngine();
    const renderer = new StandardPageRenderer();
    const target = new MockCanvasTarget();

    const doc: DocumentNode = {
      type: 'document',
      sections: [
        {
          type: 'section',
          properties: {
            pageSize: { width: 400, height: 300 },
            margins: { top: 40, right: 20, bottom: 40, left: 20 },
          },
          headers: {
            default: {
              type: 'header',
              kind: 'default',
              children: [
                {
                  type: 'paragraph',
                  children: [{ type: 'run', text: 'Canvas Running Header' }],
                },
              ],
            },
          },
          footers: {
            default: {
              type: 'footer',
              kind: 'default',
              children: [
                {
                  type: 'paragraph',
                  children: [{ type: 'run', text: 'Canvas Footer {{PAGE}}' }],
                },
              ],
            },
          },
          children: [
            {
              type: 'paragraph',
              children: [{ type: 'run', text: 'Document Body Content' }],
            },
          ],
        },
      ],
    };

    const pages = engine.layoutDocument(doc);
    expect(pages.length).toBe(1);

    renderer.renderPage(pages[0]!, target);

    const allRenderedText = target.calls
      .filter((c) => c.method === 'fillText')
      .map((c) => c.args[0])
      .join('');

    expect(allRenderedText).toContain('Canvas Running Header');
    expect(allRenderedText).toContain('Document Body Content');
    expect(allRenderedText).toContain('Canvas Footer 1');
  });

  it('should render semantic header and footer elements in StandardHtmlRenderer', () => {
    const renderer = new StandardHtmlRenderer();

    const doc: DocumentNode = {
      type: 'document',
      sections: [
        {
          type: 'section',
          properties: {
            pageSize: { width: 500, height: 700 },
            margins: { top: 50, right: 50, bottom: 50, left: 50 },
          },
          headers: {
            default: {
              type: 'header',
              kind: 'default',
              children: [
                {
                  type: 'paragraph',
                  children: [{ type: 'run', text: 'Semantic HTML Header' }],
                },
              ],
            },
          },
          footers: {
            default: {
              type: 'footer',
              kind: 'default',
              children: [
                {
                  type: 'paragraph',
                  children: [
                    { type: 'run', text: 'Page ' },
                    { type: 'run', text: '1', field: 'PAGE' },
                  ],
                },
              ],
            },
          },
          children: [
            {
              type: 'paragraph',
              children: [{ type: 'run', text: 'Article Main Body' }],
            },
          ],
        },
      ],
    };

    const html = renderer.renderToHtmlString(doc);

    expect(html).toContain('<header class="ooxen-header">');
    expect(html).toContain('Semantic HTML Header');
    expect(html).toContain('<footer class="ooxen-footer">');
    expect(html).toContain('ooxen-field-page');
    expect(html).toContain('Article Main Body');
  });
});
