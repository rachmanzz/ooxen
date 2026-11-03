import { describe, expect, it } from 'bun:test';
import { StandardPageRenderer } from '../../src/renderer/canvas/page-renderer.js';
import { StandardHtmlRenderer } from '../../src/renderer/html/html-renderer.js';
import type { CanvasTarget } from '../../src/renderer/canvas/canvas-target.js';
import type { LayoutPage } from '../../src/layout/page-engine.js';
import type { DocumentNode } from '../../src/types/ast.js';

describe('Tab Stops & Leader Renderer', () => {
  it('renders leader characters onto CanvasTarget when fragment has tabLeader', () => {
    const ops: string[] = [];
    const mockTarget: CanvasTarget = {
      save: () => ops.push('save'),
      restore: () => ops.push('restore'),
      fillText: (text: string, x: number, y: number) => ops.push(`fillText(${text}, ${x}, ${y})`),
      fillRect: (x: number, y: number, w: number, h: number) => ops.push(`fillRect(${x}, ${y}, ${w}, ${h})`),
      strokeRect: () => {},
      beginPath: () => {},
      closePath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      stroke: () => {},
      fill: () => {},
    };

    const renderer = new StandardPageRenderer();
    const page: LayoutPage = {
      pageIndex: 0,
      pageNumber: 1,
      size: { width: 612, height: 792 },
      margins: { top: 72, right: 72, bottom: 72, left: 72 },
      lines: [
        {
          bounds: { x: 72, y: 72, width: 300, height: 14 },
          baseline: 11,
          fragments: [
            {
              text: 'Topic',
              bounds: { x: 0, y: 0, width: 40, height: 14 },
            },
            {
              text: '\t',
              isTab: true,
              tabLeader: 'dot',
              bounds: { x: 40, y: 0, width: 240, height: 14 },
            },
            {
              text: '99',
              bounds: { x: 280, y: 0, width: 20, height: 14 },
            },
          ],
        },
      ],
    };

    renderer.renderPage(page, mockTarget);
    // Should have called fillText with '.' for dot leader
    const dotLeaderCalls = ops.filter((op) => op.startsWith('fillText(.,'));
    expect(dotLeaderCalls.length).toBeGreaterThan(5);
  });

  it('renders semantic <span class="ooxen-tab"> in HTML output', () => {
    const renderer = new StandardHtmlRenderer();
    const doc: DocumentNode = {
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
                {
                  type: 'run',
                  text: 'Chapter 1\t10',
                  isTab: true,
                },
              ],
            },
          ],
        },
      ],
    };

    const html = renderer.renderToHtmlString(doc);
    expect(html).toContain('<span class="ooxen-tab">&#9;</span>');
  });
});
