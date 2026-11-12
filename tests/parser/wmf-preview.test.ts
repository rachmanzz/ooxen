import { describe, expect, it } from 'bun:test';
import { convertWmfToSvg, isWmfMetafile } from '../../src/parser/dml/wmf-preview.js';

const u16 = (v: number): number[] => [v & 0xff, (v >> 8) & 0xff];
const u32 = (v: number): number[] => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff];
const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));

/** Minimal placeable WMF: one Times font, red "Hi" at (100,100), one line. */
function tinyWmf(): Uint8Array {
  const bytes: number[] = [
    0xd7, 0xcd, 0xc6, 0x9a, // placeable key
    0x00, 0x00, // handle
    ...u16(0), ...u16(0), ...u16(1000), ...u16(1000), // bbox
    ...u16(1440), // units per inch
    0x00, 0x00, 0x00, 0x00, // reserved
    0x00, 0x00, // checksum (unchecked)
  ];
  const face = ascii('Times New Roman\0');
  while (face.length < 32) face.push(0);
  bytes.push(
    ...u32(28), ...u16(0x02fb), // CreateFontIndirect
    ...u16(0xff38), // lfHeight -200
    ...u16(0), ...u16(0), ...u16(0), ...u16(400), // width, esc, orient, weight
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // italic..pitchfam
    ...face,
    ...u32(4), ...u16(0x012d), ...u16(0), // SelectObject 0
    ...u32(4), ...u16(0x012e), ...u16(0x18), // SetTextAlign TA_BASELINE
    ...u32(5), ...u16(0x0209), 0xff, 0x00, 0x00, 0x00, // SetTextColor red (COLORREF bytes R,G,B,0)
    ...u32(8), ...u16(0x0a32), // ExtTextOut
    ...u16(100), ...u16(100), ...u16(2), ...u16(0), // y, x, count, options
    ...ascii('Hi'),
    ...u32(5), ...u16(0x0214), ...u16(10), ...u16(20), // MoveTo (10,20)
    ...u32(5), ...u16(0x0213), ...u16(30), ...u16(40), // LineTo (30,40)
  );
  return new Uint8Array(bytes);
}

describe('WMF equation preview', () => {
  it('detects placeable WMF magic (F-WMFEQ)', () => {
    expect(isWmfMetafile(tinyWmf())).toBe(true);
    expect(isWmfMetafile(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
    expect(isWmfMetafile(new Uint8Array([0xd7, 0xcd]))).toBe(false);
  });

  it('converts text and lines to SVG (F-WMFEQ)', () => {
    const svg = convertWmfToSvg(tinyWmf());
    expect(svg).toBeDefined();
    expect(svg!).toContain('<svg');
    expect(svg!).toContain('Hi');
    expect(svg!).toContain('<line');
    // 200 units at 1440/inch = 10pt.
    expect(svg!).toContain('font-size="10"');
    expect(svg!).toContain('#FF0000');
  });

  it('addresses text runs by baseline, not box top (F-WMFEQ)', async () => {
    const { parseWmfPreview } = await import('../../src/parser/dml/wmf-preview.js');
    const preview = parseWmfPreview(tinyWmf());
    expect(preview).toBeDefined();
    // 100 units at 1440/inch = 5pt, with no ascent offset added.
    expect(preview!.texts[0]!.y).toBeCloseTo(5, 5);
    expect(preview!.texts[0]!.sizePt).toBeCloseTo(10, 5);
  });

  it('honors the count field over padded record bytes (F-WMFEQ)', async () => {
    const { parseWmfPreview } = await import('../../src/parser/dml/wmf-preview.js');
    const u16 = (v: number): number[] => [v & 0xff, (v >> 8) & 0xff];
    const bytes = new Uint8Array([
      0xd7, 0xcd, 0xc6, 0x9a, 0x00, 0x00,
      ...u16(0), ...u16(0), ...u16(1000), ...u16(1000),
      ...u16(1440), 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      // ExtTextOut count=1 with two string bytes present: draws one char.
      0x08, 0x00, 0x00, 0x00, 0x32, 0x0a,
      ...u16(100), ...u16(100), ...u16(1), ...u16(0),
      0x53, 0x79,
    ]);
    const preview = parseWmfPreview(bytes);
    expect(preview?.texts.map((t) => t.text)).toEqual(['S']);
  });

  it('tracks pens, brushes, and DeleteObject in the object table (F-WMFEQ)', async () => {
    const { parseWmfPreview } = await import('../../src/parser/dml/wmf-preview.js');
    const face = ascii('Symbol\0');
    while (face.length < 32) face.push(0);
    const fontRecord = (heightUnits: number): number[] => [
      ...u32(28), ...u16(0x02fb),
      ...u16(heightUnits & 0xffff),
      ...u16(0), ...u16(0), ...u16(0), ...u16(400),
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      ...face,
    ];
    const bytes = new Uint8Array([
      0xd7, 0xcd, 0xc6, 0x9a, 0x00, 0x00,
      ...u16(0), ...u16(0), ...u16(1000), ...u16(1000),
      ...u16(1440), 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      // MathType order: pen (slot 0), brush (slot 1), then the font (slot 2).
      ...u32(8), ...u16(0x02fa), ...u16(0), ...u16(20), ...u16(0), 0x00, 0x00, 0xff, 0x00, // CreatePenIndirect blue, width 20
      ...u32(7), ...u16(0x02fc), ...u16(0), 0x00, 0x00, 0x00, 0x00, ...u16(0), // CreateBrushIndirect
      ...fontRecord(400), // 20pt font in slot 2
      ...u32(4), ...u16(0x012d), ...u16(2), // SelectObject 2 (the font)
      ...u32(4), ...u16(0x012d), ...u16(0), // SelectObject 0 (the pen)
      ...u32(7), ...u16(0x0521), ...u16(1), ...ascii('a'), 0x00, ...u16(100), ...u16(100), // TextOut "a" (padded)
      ...u32(5), ...u16(0x0214), ...u16(10), ...u16(20), // MoveTo
      ...u32(5), ...u16(0x0213), ...u16(30), ...u16(40), // LineTo in the blue pen
      ...u32(4), ...u16(0x01f0), ...u16(1), // DeleteObject 1 (the brush)
      ...fontRecord(200), // 10pt font reuses freed slot 1
      ...u32(4), ...u16(0x012d), ...u16(1), // SelectObject 1 (the new font)
      ...u32(7), ...u16(0x0521), ...u16(1), ...ascii('b'), 0x00, ...u16(300), ...u16(100),
    ]);
    const preview = parseWmfPreview(bytes)!;
    expect(preview.texts.map((t) => t.text)).toEqual(['a', 'b']);
    expect(preview.texts[0]!.sizePt).toBeCloseTo(20, 5);
    expect(preview.texts[1]!.sizePt).toBeCloseTo(10, 5);
    expect(preview.lines[0]!.color).toBe('#0000FF');
    expect(preview.lines[0]!.widthPt).toBeCloseTo(1, 5);
  });

  it('reads coordinates as signed INT16 (F-WMFEQ)', async () => {
    const { parseWmfPreview } = await import('../../src/parser/dml/wmf-preview.js');
    const bytes = new Uint8Array([
      0xd7, 0xcd, 0xc6, 0x9a, 0x00, 0x00,
      // bbox left=-20, top=-300, right=400, bottom=100: origin on the baseline.
      ...u16(-20 & 0xffff), ...u16(-300 & 0xffff), ...u16(400), ...u16(100),
      ...u16(1440), 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      ...u32(4), ...u16(0x012e), ...u16(0x18), // SetTextAlign TA_BASELINE
      ...u32(7), ...u16(0x0521), ...u16(1), ...ascii('x'), 0x00, ...u16(-10 & 0xffff), ...u16(0),
    ]);
    const preview = parseWmfPreview(bytes)!;
    expect(preview.widthPt).toBeCloseTo(21, 5);
    expect(preview.heightPt).toBeCloseTo(20, 5);
    // y = -10 units relative to top = -300 → 290 units = 14.5pt.
    expect(preview.texts[0]!.y).toBeCloseTo(14.5, 5);
    expect(preview.texts[0]!.x).toBeCloseTo(1, 5);
  });

  it('does not throw on a truncated pen record at the end of the buffer (F-WMFEQ)', async () => {
    const { parseWmfPreview } = await import('../../src/parser/dml/wmf-preview.js');
    const bytes = new Uint8Array([
      0xd7, 0xcd, 0xc6, 0x9a, 0x00, 0x00,
      ...u16(0), ...u16(0), ...u16(1000), ...u16(1000),
      ...u16(1440), 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      ...u32(7), ...u16(0x0521), ...u16(1), ...ascii('x'), 0x00, ...u16(100), ...u16(100),
      // CreatePenIndirect declared with only 8 param bytes.
      ...u32(7), ...u16(0x02fa), ...u16(0), ...u16(1), ...u16(0), 0x00, 0x00,
    ]);
    expect(() => parseWmfPreview(bytes)).not.toThrow();
    expect(parseWmfPreview(bytes)?.texts.map((t) => t.text)).toEqual(['x']);
  });

  it('returns undefined for garbage or truncated input (F-WMFEQ)', () => {
    expect(convertWmfToSvg(new Uint8Array([1, 2, 3, 4]))).toBeUndefined();
    expect(convertWmfToSvg(tinyWmf().slice(0, 30))).toBeUndefined();
    // Valid header, no drawable records.
    expect(convertWmfToSvg(tinyWmf().slice(0, 22))).toBeUndefined();
  });

  it('skips the META_HEADER after the placeable header without resyncing (F-WMFEQ)', async () => {
    const { parseWmfPreview } = await import('../../src/parser/dml/wmf-preview.js');
    const bytes = new Uint8Array([
      0xd7, 0xcd, 0xc6, 0x9a, 0x00, 0x00,
      ...u16(0), ...u16(0), ...u16(1000), ...u16(1000),
      ...u16(1440), 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      // META_HEADER: type 1, header size 9 words, version 0x0300, size, objects, max record, members.
      ...u16(1), ...u16(9), ...u16(0x0300), ...u32(40), ...u16(1), ...u32(8), ...u16(0),
      // First record is one the resync scanner does not recognize.
      ...u32(4), ...u16(0x0104), ...u16(13), // SetROP2
      ...u32(4), ...u16(0x012e), ...u16(0x18), // SetTextAlign TA_BASELINE
      ...u32(8), ...u16(0x0a32), ...u16(100), ...u16(100), ...u16(2), ...u16(0), ...ascii('Hi'),
    ]);
    const preview = parseWmfPreview(bytes);
    expect(preview?.texts.map((t) => t.text)).toEqual(['Hi']);
    expect(preview?.texts[0]!.y).toBeCloseTo(5, 5);
  });

  it('skips the ETO_CLIPPED/ETO_OPAQUE rectangle before the ExtTextOut string (F-WMFEQ)', async () => {
    const { parseWmfPreview } = await import('../../src/parser/dml/wmf-preview.js');
    const bytes = new Uint8Array([
      0xd7, 0xcd, 0xc6, 0x9a, 0x00, 0x00,
      ...u16(0), ...u16(0), ...u16(1000), ...u16(1000),
      ...u16(1440), 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      // ExtTextOut with ETO_CLIPPED (0x04): y, x, count, opts, rect(4 x int16), string.
      ...u32(12), ...u16(0x0a32), ...u16(100), ...u16(100), ...u16(2), ...u16(0x04),
      ...u16(0), ...u16(0), ...u16(500), ...u16(500),
      ...ascii('Hi'),
    ]);
    expect(parseWmfPreview(bytes)?.texts.map((t) => t.text)).toEqual(['Hi']);
  });

  it('skips records larger than 1 KiB by their declared size (F-WMFEQ)', async () => {
    const { parseWmfPreview } = await import('../../src/parser/dml/wmf-preview.js');
    const blobWords = 700;
    const bytes = new Uint8Array([
      0xd7, 0xcd, 0xc6, 0x9a, 0x00, 0x00,
      ...u16(0), ...u16(0), ...u16(1000), ...u16(1000),
      ...u16(1440), 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      // Escape MFCOMMENT carrying an opaque payload (MathType MTEF blob).
      ...u32(3 + blobWords), ...u16(0x0626), ...new Array(blobWords * 2).fill(0x41),
      ...u32(8), ...u16(0x0a32), ...u16(100), ...u16(100), ...u16(2), ...u16(0), ...ascii('Hi'),
    ]);
    expect(parseWmfPreview(bytes)?.texts.map((t) => t.text)).toEqual(['Hi']);
  });

  it('converts TA_TOP and TA_BOTTOM reference points to the baseline (F-WMFEQ)', async () => {
    const { parseWmfPreview } = await import('../../src/parser/dml/wmf-preview.js');
    const face = ascii('Times New Roman\0');
    while (face.length < 32) face.push(0);
    const header = [
      0xd7, 0xcd, 0xc6, 0x9a, 0x00, 0x00,
      ...u16(0), ...u16(0), ...u16(1000), ...u16(1000),
      ...u16(1440), 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      ...u32(28), ...u16(0x02fb), ...u16(200), ...u16(0), ...u16(0), ...u16(0), ...u16(400),
      0, 0, 0, 0, 0, 0, 0, 0, ...face,
      ...u32(4), ...u16(0x012d), ...u16(0),
    ];
    const text = [...u32(8), ...u16(0x0a32), ...u16(100), ...u16(100), ...u16(2), ...u16(0), ...ascii('Hi')];
    // Default TA_TOP: y is the cell top, baseline sits one ascent below.
    const top = parseWmfPreview(new Uint8Array([...header, ...text]))!;
    expect(top.texts[0]!.y).toBeCloseTo((100 + 200 * 0.8) * 0.05, 5);
    // TA_BOTTOM: y is the cell bottom, baseline sits one descent above.
    const bottom = parseWmfPreview(new Uint8Array([...header, ...u32(4), ...u16(0x012e), ...u16(0x08), ...text]))!;
    expect(bottom.texts[0]!.y).toBeCloseTo((100 - 200 * 0.2) * 0.05, 5);
    // TA_BASELINE: y is already the baseline.
    const base = parseWmfPreview(new Uint8Array([...header, ...u32(4), ...u16(0x012e), ...u16(0x18), ...text]))!;
    expect(base.texts[0]!.y).toBeCloseTo(5, 5);
  });
});
