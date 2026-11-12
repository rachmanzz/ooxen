import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const cssPath = join(repoRoot, 'src', 'renderer', 'html', 'ooxen.css');

// Every ooxen-* class emitted by StandardHtmlRenderer must have a rule in
// the built-in stylesheet so consumers get sane output from a bare import.
const EXPECTED_SELECTORS = [
  '.ooxen-document',
  '.ooxen-section',
  '.ooxen-header',
  '.ooxen-footer',
  '.ooxen-p',
  '.ooxen-r',
  '.ooxen-bullet',
  '.ooxen-tab',
  '.ooxen-tab-run',
  '.ooxen-table',
  '.ooxen-tr',
  '.ooxen-tc',
  '.ooxen-image',
  '.ooxen-shape',
  '.ooxen-link',
  '.ooxen-footnote-ref',
  '.ooxen-endnote-ref',
  '.ooxen-footnotes',
  '.ooxen-footnote-separator',
  '.ooxen-endnotes',
  '.ooxen-endnote-separator',
  '.ooxen-comments',
  '.ooxen-comment-card',
  '.ooxen-comment',
  '.ooxen-ins',
  '.ooxen-del',
  '.ooxen-page-break',
  '.ooxen-column-break',
];

describe('Ooxen built-in CSS', () => {
  it('ships a stylesheet covering every renderer class', () => {
    expect(existsSync(cssPath)).toBe(true);
    const css = readFileSync(cssPath, 'utf8');
    expect(css.length).toBeGreaterThan(0);
    for (const selector of EXPECTED_SELECTORS) {
      expect(css).toContain(selector);
    }
    // Dynamic field runs (ooxen-field-page, ...) share one rule.
    expect(css).toContain("ooxen-field-");
  });

  it('exposes the stylesheet through the package exports map', () => {
    const pkg = JSON.parse(
      readFileSync(join(repoRoot, 'package.json'), 'utf8'),
    ) as {
      style?: string;
      exports?: Record<string, string | Record<string, string>>;
    };
    expect(pkg.exports?.['./css']).toBe('./dist/renderer/html/ooxen.css');
    expect(pkg.style).toBe('./dist/renderer/html/ooxen.css');
  });

  it('aligns HTML tab characters to the 36pt default tab grid (F-TABLEAD)', () => {
    const css = readFileSync(cssPath, 'utf8');
    const docRule = /\.ooxen-document \{[^}]*\}/.exec(css)?.[0] ?? '';
    expect(docRule).toContain('tab-size: 36pt');
    const tabRule = /\.ooxen-document \.ooxen-tab \{[^}]*\}/.exec(css)?.[0] ?? '';
    expect(tabRule).toContain('white-space: pre');
  });
});
