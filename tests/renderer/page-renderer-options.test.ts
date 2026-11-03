import { describe, expect, it } from 'bun:test';
import { StandardPageEngine } from '../../src/layout/page-engine.js';
import { StandardPageRenderer } from '../../src/renderer/canvas/page-renderer.js';
import type { CanvasTarget } from '../../src/renderer/canvas/canvas-target.js';
import type { DocumentNode } from '../../src/types/ast.js';

describe('StandardPageRenderer Decoupled & Callback Options (e.g. book-canvas)', () => {
  const createMockCanvas = () => {
    const operations: string[] = [];
    const target: CanvasTarget = {
      font: '',
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      save: () => operations.push('save'),
      restore: () => operations.push('restore'),
      translate: (x, y) => operations.push(`translate(${x},${y})`),
      scale: (x, y) => operations.push(`scale(${x},${y})`),
      fillText: (t, x, y) => operations.push(`fillText(${t},${x},${y})`),
      strokeRect: (x, y, w, h) => operations.push(`strokeRect(${x},${y},${w},${h})`),
      fillRect: (x, y, w, h) => operations.push(`fillRect(${x},${y},${w},${h})`),
    };
    return { target, operations };
  };

  const testDoc: DocumentNode = {
    type: 'document',
    sections: [
      {
        type: 'section',
        properties: {
          pageSize: { width: 612, height: 792 },
          margins: { top: 72, right: 72, bottom: 72, left: 72 },
          orientation: 'portrait',
        },
        headers: {
          default: {
            type: 'header',
            kind: 'default',
            children: [{ type: 'paragraph', children: [{ type: 'run', text: 'Top Header Text' }] }],
          },
        },
        footers: {
          default: {
            type: 'footer',
            kind: 'default',
            children: [{ type: 'paragraph', children: [{ type: 'run', text: 'Bottom Footer Text' }] }],
          },
        },
        children: [
          {
            type: 'paragraph',
            children: [{ type: 'run', text: 'Body Content Paragraph' }],
          },
        ],
      },
    ],
  };

  it('should render full chrome in default mode', () => {
    const engine = new StandardPageEngine();
    const [page] = engine.layoutDocument(testDoc);
    expect(page).toBeDefined();

    const renderer = new StandardPageRenderer();
    const { target, operations } = createMockCanvas();

    renderer.renderPage(page!, target);

    // Operations should include paper background fillRect(0,0,612,792), header text, body text, footer text
    expect(operations).toContain('fillRect(0,0,612,792)');
    expect(operations.some((op) => op.includes('fillText(Top'))).toBe(true);
    expect(operations.some((op) => op.includes('fillText(Body'))).toBe(true);
    expect(operations.some((op) => op.includes('fillText(Bottom'))).toBe(true);
  });

  it('should render only body when bodyOnly is enabled and emit callbacks for external consumers', () => {
    const engine = new StandardPageEngine();
    const [page] = engine.layoutDocument(testDoc);
    expect(page).toBeDefined();

    const renderer = new StandardPageRenderer();
    const { target, operations } = createMockCanvas();

    let metaReceived: any;
    let headerReceived: any;
    let footerReceived: any;

    renderer.renderPage(page!, target, {
      bodyOnly: true,
      onPageMeta: (meta) => {
        metaReceived = meta;
      },
      onHeader: (lines) => {
        headerReceived = lines;
      },
      onFooter: (lines) => {
        footerReceived = lines;
      },
    });

    // 1. Paper background fillRect(0,0,612,792) must NOT be drawn to canvas
    expect(operations).not.toContain('fillRect(0,0,612,792)');

    // 2. Header and footer text must NOT be drawn to canvas
    expect(operations.some((op) => op.includes('fillText(Top'))).toBe(false);
    expect(operations.some((op) => op.includes('fillText(Bottom'))).toBe(false);

    // 3. Body text MUST be drawn to canvas
    expect(operations.some((op) => op.includes('fillText(Body'))).toBe(true);

    // 4. Callbacks must receive chrome elements
    expect(metaReceived).toBeDefined();
    expect(metaReceived.pageIndex).toBe(0);
    expect(metaReceived.pageNumber).toBe(1);
    expect(metaReceived.orientation).toBe('portrait');

    expect(headerReceived).toBeDefined();
    expect(headerReceived.length).toBeGreaterThan(0);
    const headerText = headerReceived[0].fragments.map((f: any) => f.text).join('');
    expect(headerText).toBe('Top Header Text');

    expect(footerReceived).toBeDefined();
    expect(footerReceived.length).toBeGreaterThan(0);
    const footerText = footerReceived[0].fragments.map((f: any) => f.text).join('');
    expect(footerText).toBe('Bottom Footer Text');
  });
});
