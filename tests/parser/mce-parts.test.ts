import { describe, expect, it } from 'bun:test';
import { StandardCommentParser } from '../../src/parser/wml/comment-parser.js';
import { parseEndnotesXml, parseFootnotesXml } from '../../src/parser/wml/footnote-parser.js';
import { parseHeaderFooterXml } from '../../src/parser/wml/header-footer-parser.js';

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"';
const choice = (inner: string): string =>
  `<mc:AlternateContent><mc:Choice Requires="w">${inner}</mc:Choice><mc:Fallback><w:p><w:r><w:t>fallback</w:t></w:r></w:p></mc:Fallback></mc:AlternateContent>`;

// F-MCEPARTS: AlternateContent must resolve in footnote/endnote/comment/
// header parts exactly as it does in document/styles/numbering parts.
describe('Markup compat in part parsers (F-MCEPARTS)', () => {
  it('parses footnotes wrapped in AlternateContent Choice', () => {
    const xml =
      `<w:footnotes ${NS}>` +
      choice('<w:footnote w:id="1"><w:p><w:r><w:t>MCE footnote text.</w:t></w:r></w:p></w:footnote>') +
      `</w:footnotes>`;
    const notes = parseFootnotesXml(xml);
    expect(notes.length).toBe(1);
    expect(notes[0]!.id).toBe(1);
  });

  it('parses endnotes wrapped in AlternateContent Choice', () => {
    const xml =
      `<w:endnotes ${NS}>` +
      choice('<w:endnote w:id="2"><w:p><w:r><w:t>MCE endnote text.</w:t></w:r></w:p></w:endnote>') +
      `</w:endnotes>`;
    const notes = parseEndnotesXml(xml);
    expect(notes.length).toBe(1);
    expect(notes[0]!.id).toBe(2);
  });

  it('parses comments wrapped in AlternateContent Choice', () => {
    const xml =
      `<w:comments ${NS}>` +
      choice('<w:comment w:id="0"><w:p><w:r><w:t>MCE comment text.</w:t></w:r></w:p></w:comment>') +
      `</w:comments>`;
    const comments = new StandardCommentParser().parseCommentsXml(xml);
    expect(comments.length).toBe(1);
  });

  it('parses headers wrapped in AlternateContent Choice', () => {
    const xml =
      `<w:hdr ${NS}>` +
      choice('<w:p><w:r><w:t>MCE header text.</w:t></w:r></w:p>') +
      `</w:hdr>`;
    const header = parseHeaderFooterXml(xml, 'default');
    const text = JSON.stringify(header.children);
    expect(text).toContain('MCE header text');
  });
});
