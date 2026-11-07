import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { StandardHtmlRenderer } from '../../src/renderer/html/html-renderer.js';
import type { DocumentNode, ImageNode } from '../../src/types/ast.js';

const FLOAT_CSS_PATH = new URL('../../src/renderer/html/ooxen.css', import.meta.url);

// F-HTMLFLOAT: anchored images must render as positioned floats (with
// behindDoc layered behind text), not as inline images.
const floatImage = (overrides?: Partial<ImageNode>): ImageNode => ({
  type: 'image',
  name: 'Float.png',
  widthPt: 200,
  heightPt: 100,
  src: 'float.png',
  anchor: {
    horizontalFrom: 'column',
    horizontalOffsetPt: 36,
    verticalFrom: 'paragraph',
    verticalOffsetPt: 12,
  },
  ...overrides,
});

const docWith = (image: ImageNode): DocumentNode => ({
  type: 'document',
  sections: [
    {
      type: 'section',
      properties: {
        pageSize: { width: 612, height: 792 },
        margins: { top: 72, right: 72, bottom: 72, left: 72 },
      },
      children: [{ type: 'paragraph', children: [{ type: 'run', text: 'Hi ' }, { type: 'run', text: '', image }] }],
    },
  ],
});

describe('HTML float rendering (F-HTMLFLOAT)', () => {
  const renderer = new StandardHtmlRenderer();

  it('renders anchored images as absolute floats, not inline', () => {
    const html = renderer.renderToHtmlString(docWith(floatImage()));
    expect(html).toContain('ooxen-float');
    expect(html).toContain('position: absolute');
    expect(html).not.toMatch(/<img class="ooxen-image" /);
  });

  it('layers behindDoc floats behind text', () => {
    const html = renderer.renderToHtmlString(
      docWith(floatImage({ anchor: { horizontalFrom: 'column', horizontalOffsetPt: 0, verticalFrom: 'paragraph', verticalOffsetPt: 0, behindDoc: true } })),
    );
    expect(html).toContain('ooxen-behind-doc');
  });

  it('resolves align placement to CSS instead of offset zero', () => {
    const html = renderer.renderToHtmlString(
      docWith(
        floatImage({
          anchor: { horizontalFrom: 'column', horizontalOffsetPt: 0, horizontalAlign: 'center', verticalFrom: 'page', verticalOffsetPt: 0, verticalAlign: 'bottom' },
        }),
      ),
    );
    expect(html).toContain('calc(50%');
    expect(html).toContain('bottom: 0');
  });

  it('ships float positioning in the built-in CSS', () => {
    const css = readFileSync(FLOAT_CSS_PATH, 'utf8');
    expect(css).toContain('.ooxen-float');
    expect(css).toContain('.ooxen-has-float');
    expect(css).toContain('.ooxen-behind-doc');
  });
});
