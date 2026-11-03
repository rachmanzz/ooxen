import { describe, expect, it } from 'bun:test';
import { defaultXmlAdapter } from '../../src/parser/xml-adapter.js';
import { StandardParagraphParser } from '../../src/parser/wml/paragraph-parser.js';
import { defaultWmlBuilder } from '../../src/serializer/wml-builder.js';

const parser = new StandardParagraphParser();

describe('Lossless run segments (futures §5.1 / roast N7)', () => {
  it('builds exact segments for interleaved text, breaks, and tabs', () => {
    const xml = '<w:r><w:t>a</w:t><w:br/><w:tab/><w:t>b</w:t></w:r>';
    const run = parser.parseRun(defaultXmlAdapter.parse(xml));

    expect(run.segments).toEqual([
      { type: 'text', text: 'a' },
      { type: 'break', breakType: 'line' },
      { type: 'tab' },
      { type: 'text', text: 'b' },
    ]);
    // Flattened view stays compatible for renderers.
    expect(run.text).toBe('a\n\tb');
  });

  it('distinguishes a literal tab character inside w:t from a w:tab element', () => {
    const xml = '<w:r><w:t>a\tb</w:t><w:tab/><w:t>c</w:t></w:r>';
    const run = parser.parseRun(defaultXmlAdapter.parse(xml));

    expect(run.segments).toEqual([
      { type: 'text', text: 'a\tb' },
      { type: 'tab' },
      { type: 'text', text: 'c' },
    ]);
  });

  it('keeps page/column breaks typed separately from line breaks', () => {
    const xml = '<w:r><w:t>x</w:t><w:br w:type="page"/><w:t>y</w:t><w:br w:type="column"/><w:t>z</w:t></w:r>';
    const run = parser.parseRun(defaultXmlAdapter.parse(xml));

    expect(run.segments).toEqual([
      { type: 'text', text: 'x' },
      { type: 'break', breakType: 'page' },
      { type: 'text', text: 'y' },
      { type: 'break', breakType: 'column' },
      { type: 'text', text: 'z' },
    ]);
    expect(run.breakType).toBe('column');
  });

  it('merges sibling w:t elements into separate segments instead of one w:t', () => {
    const xml = '<w:r><w:t>ab</w:t><w:t>cd</w:t></w:r>';
    const run = parser.parseRun(defaultXmlAdapter.parse(xml));

    // Two text segments (two w:t in source), not one merged 'abcd' segment.
    expect(run.segments).toEqual([
      { type: 'text', text: 'ab' },
      { type: 'text', text: 'cd' },
    ]);
    expect(run.text).toBe('abcd');
  });

  it('round-trips an interleaved run through parse and serialize unchanged', () => {
    const xml = '<w:r><w:t>a</w:t><w:br/><w:tab/><w:t xml:space="preserve"> b </w:t></w:r>';
    const run = parser.parseRun(defaultXmlAdapter.parse(xml));
    const serialized = defaultWmlBuilder.buildParagraphXml({
      type: 'paragraph',
      children: [run],
    });

    expect(serialized).toContain('<w:t>a</w:t>');
    expect(serialized).toContain('<w:br/>');
    expect(serialized).toContain('<w:tab/>');
    expect(serialized).toContain('<w:t xml:space="preserve"> b </w:t>');
    // Exact source order preserved: text, br, tab, text.
    const order = ['<w:t>a</w:t>', '<w:br/>', '<w:tab/>', '<w:t xml:space="preserve"> b </w:t>'].map((marker) => serialized.indexOf(marker));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('omits segments for simple single-text runs (legacy path is exact)', () => {
    const xml = '<w:r><w:t>plain</w:t></w:r>';
    const run = parser.parseRun(defaultXmlAdapter.parse(xml));
    expect(run.segments).toBeUndefined();
    expect(run.text).toBe('plain');
  });
});
