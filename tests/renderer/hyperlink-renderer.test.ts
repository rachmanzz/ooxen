import { describe, expect, it } from 'bun:test';
import { hitTestPage } from '../../src/layout/hit-test.js';
import { StandardLineBreaker } from '../../src/layout/line-breaker.js';
import { StandardPageEngine } from '../../src/layout/page-engine.js';
import { StandardHtmlRenderer } from '../../src/renderer/html/html-renderer.js';
import type { DocumentNode, ParagraphNode } from '../../src/types/ast.js';

describe('Hyperlink & Bookmark Layout & Renderer', () => {
  it('should preserve hyperlink info on line fragments during line breaking', () => {
    const breaker = new StandardLineBreaker();
    const paragraph: ParagraphNode = {
      type: 'paragraph',
      bookmarkName: 'top_bookmark',
      children: [
        {
          type: 'run',
          text: 'Visit our ',
        },
        {
          type: 'run',
          text: 'official website',
          hyperlink: { url: 'https://ooxen.org', tooltip: 'Official Site' },
          style: { underline: true, color: '#0000EE' },
        },
        {
          type: 'run',
          text: ' for details.',
        },
      ],
    };

    const lines = breaker.breakParagraph(paragraph, 400);
    expect(lines.length).toBe(1);

    const frags = lines[0]!.fragments;
    const linkFrag = frags.find((f) => f.text === 'official' || f.text === 'website');
    expect(linkFrag).toBeDefined();
    expect(linkFrag?.hyperlink?.url).toBe('https://ooxen.org');
    expect(linkFrag?.hyperlink?.tooltip).toBe('Official Site');
  });

  it('should identify clicked hyperlink when hit-testing a page coordinate', () => {
    const doc: DocumentNode = {
      type: 'document',
      sections: [
        {
          type: 'section',
          properties: {
            pageSize: { width: 500, height: 400 },
            margins: { top: 50, right: 50, bottom: 50, left: 50 },
          },
          children: [
            {
              type: 'paragraph',
              children: [
                {
                  type: 'run',
                  text: 'Click here: ',
                },
                {
                  type: 'run',
                  text: 'DeveloperPortal',
                  hyperlink: { url: 'https://developer.ooxen.org' },
                },
              ],
            },
          ],
        },
      ],
    };

    const engine = new StandardPageEngine();
    const pages = engine.layoutDocument(doc);
    expect(pages.length).toBe(1);

    const page = pages[0]!;
    const line = page.lines[0]!;

    // Find the fragment of the hyperlink
    const linkFrag = line.fragments.find((f) => f.text === 'DeveloperPortal');
    expect(linkFrag).toBeDefined();

    // Calculate coordinate right in the middle of the link fragment
    const clickX = line.bounds.x + linkFrag!.bounds.x + linkFrag!.bounds.width / 2;
    const clickY = line.bounds.y + linkFrag!.bounds.y + linkFrag!.bounds.height / 2;

    const hit = hitTestPage(page, clickX, clickY);
    expect(hit).toBeDefined();
    expect(hit?.hyperlink).toBeDefined();
    expect(hit?.hyperlink?.url).toBe('https://developer.ooxen.org');
  });

  it('should render semantic <a> elements with href, title, and id in HTML renderer', () => {
    const renderer = new StandardHtmlRenderer();
    const doc: DocumentNode = {
      type: 'document',
      sections: [
        {
          type: 'section',
          properties: {
            pageSize: { width: 600, height: 800 },
            margins: { top: 50, right: 50, bottom: 50, left: 50 },
          },
          children: [
            {
              type: 'paragraph',
              bookmarkName: 'bm_intro',
              children: [
                {
                  type: 'run',
                  text: 'External: ',
                },
                {
                  type: 'run',
                  text: 'Google Search',
                  hyperlink: { url: 'https://google.com', tooltip: 'Search Engine' },
                },
                {
                  type: 'run',
                  text: ' | Internal: ',
                },
                {
                  type: 'run',
                  text: 'Jump to Intro',
                  hyperlink: { anchor: 'bm_intro' },
                },
              ],
            },
          ],
        },
      ],
    };

    const html = renderer.renderToHtmlString(doc);

    expect(html).toContain('id="bm_intro"');
    expect(html).toContain('<a class="ooxen-link" href="https://google.com" title="Search Engine">');
    expect(html).toContain('Google Search');
    expect(html).toContain('<a class="ooxen-link" href="#bm_intro">');
    expect(html).toContain('Jump to Intro');
  });
});
