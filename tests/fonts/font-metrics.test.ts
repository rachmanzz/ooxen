import { describe, expect, it, beforeEach } from 'bun:test';
import { parseTtf, type ParsedFontMetrics } from '../../src/fonts/ttf-parser.js';
import { FontMetricsRegistry, globalFontMetrics } from '../../src/fonts/font-metrics-registry.js';
import { deobfuscateOdttf, loadEmbeddedFonts } from '../../src/fonts/font-table-loader.js';
import { SimpleTextMetricsMeasurer, measureTextWidth } from '../../src/layout/text-metrics.js';
import { createPackage, type OpcPackage } from '../../src/opc/package.js';

// ---------------------------------------------------------------------------
// Synthetic TTF builder — deterministic font fixture with known metrics.
// Glyphs: 0=.notdef, 1=space(250), 2='A'(700), 3='a'(500) at unitsPerEm=1000.
// ---------------------------------------------------------------------------

function u16(value: number): number[] {
  return [(value >> 8) & 0xff, value & 0xff];
}

function i16(value: number): number[] {
  return u16(value < 0 ? value + 0x10000 : value);
}

function u32(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

interface TestFontOptions {
  unitsPerEm?: number;
  ascender?: number;
  descender?: number;
  advances?: Array<[number, number]>; // [glyphId, advance]
  cmapEntries?: Array<[number, number]>; // [charCode, glyphId]
  cmapFormat?: 4 | 0; // Mac-roman format 0 exercises the unsupported-cmap path
  weightClass?: number;
  familyName?: string;
}

function buildTestFont(options: TestFontOptions = {}): Uint8Array {
  const {
    unitsPerEm = 1000,
    ascender = 800,
    descender = -200,
    advances = [[0, 0], [1, 250], [2, 700], [3, 500]],
    cmapEntries = [[0x20, 1], [0x41, 2], [0x61, 3]],
    cmapFormat = 4,
    weightClass = 400,
    familyName = 'TestFont',
  } = options;

  const head: number[] = [
    ...u32(0x00010000), ...u32(0x00010000), ...u32(0), ...u32(0x5f0f3cf5),
    ...u16(0), ...u16(unitsPerEm),
    ...Array(8).fill(0), // created/modified
    ...i16(0), ...i16(0), ...i16(0), ...i16(0), // bbox
    ...u16(0), ...u16(8), ...i16(2), ...i16(0), ...i16(0),
  ];

  const hhea: number[] = [
    ...u32(0x00010000),
    ...i16(ascender), ...i16(descender), ...i16(0),
    ...u16(1000), ...u16(0), ...u16(0), ...u16(1000),
    ...i16(1), ...i16(0), ...i16(0),
    ...Array(8).fill(0), // reserved
    ...i16(0), ...u16(advances.length),
  ];

  const hmtx: number[] = [];
  for (const [, advance] of advances) hmtx.push(...u16(advance), ...i16(0));

  // cmap format 4 with one segment per entry plus the 0xFFFF sentinel.
  const segments = [...cmapEntries.map(([char, gid]) => ({ start: char, end: char, delta: gid - char })), { start: 0xffff, end: 0xffff, delta: 1 }];
  const segCount = segments.length;
  const segCountX2 = segCount * 2;
  const subtable: number[] = [
    ...u16(4), ...u16(16 + segCountX2 * 4 + 2), ...u16(0),
    ...u16(segCountX2), ...u16(2), ...u16(1), ...u16(segCountX2 - 2),
    ...segments.flatMap((s) => u16(s.end)),
    ...u16(0), // reservedPad
    ...segments.flatMap((s) => u16(s.start)),
    ...segments.flatMap((s) => i16(s.delta)),
    ...segments.flatMap(() => u16(0)), // idRangeOffset = 0 → delta arithmetic
  ];
  const format0Subtable: number[] = [
    ...u16(0),
    ...u16(262),
    ...u16(0),
    ...Array.from({ length: 256 }, (_, code) => cmapEntries.find(([char]) => char === code)?.[1] ?? 0),
  ];
  const cmap: number[] =
    cmapFormat === 0
      ? [...u16(0), ...u16(1), ...u16(3), ...u16(1), ...u32(12), ...format0Subtable]
      : [...u16(0), ...u16(1), ...u16(3), ...u16(1), ...u32(12), ...subtable];

  const os2: number[] = [...u16(4), ...i16(500), ...u16(weightClass), ...Array(76).fill(0)];

  // name table: one platform-3 (Windows UTF-16BE) record, name id 1 (family).
  const nameChars = [...familyName].map((c) => c.charCodeAt(0));
  const nameString = nameChars.flatMap((c) => u16(c));
  const name: number[] = [
    ...u16(0), ...u16(1), ...u16(6 + 12),
    ...u16(3), ...u16(1), ...u16(0x409), ...u16(1), ...u16(nameString.length), ...u16(0),
    ...nameString,
  ];

  const tableData: Array<[string, number[]]> = [
    ['head', head],
    ['hhea', hhea],
    ['hmtx', hmtx],
    ['cmap', cmap],
    ['OS/2', os2],
    ['name', name],
  ];

  const numTables = tableData.length;
  const directorySize = 12 + numTables * 16;
  let offset = directorySize;
  const placed: Array<[string, number, number[]]> = [];
  for (const [tag, data] of tableData) {
    placed.push([tag, offset, data]);
    offset += data.length;
    if (offset % 4 !== 0) offset += 4 - (offset % 4);
  }

  const totalSize = offset;
  const font = new Uint8Array(totalSize);
  const view = (bytes: number[], at: number) => bytes.forEach((b, i) => (font[at + i] = b));

  view([...u32(0x00010000), ...u16(numTables), ...u16(16), ...u16(4), ...u16(0)], 0);
  placed.forEach(([tag, tableOffset, data], i) => {
    const record = 12 + i * 16;
    view([...tag].map((c) => c.charCodeAt(0)), record);
    view(u32(0), record + 4); // checksum unused
    view(u32(tableOffset), record + 8);
    view(u32(data.length), record + 12);
    view(data, tableOffset);
  });

  return font;
}

// ---------------------------------------------------------------------------
// ttf-parser
// ---------------------------------------------------------------------------

describe('TTF font metrics parser', () => {
  let font: ParsedFontMetrics;

  beforeEach(() => {
    font = parseTtf(buildTestFont());
  });

  it('reads unitsPerEm and vertical metrics', () => {
    expect(font.unitsPerEm).toBe(1000);
    expect(font.ascender).toBe(800);
    expect(font.descender).toBe(-200);
    expect(font.weightClass).toBe(400);
    expect(font.familyName).toBe('TestFont');
  });

  it('resolves per-character advance widths through cmap→hmtx', () => {
    expect(font.advanceOf(' ')).toBe(250);
    expect(font.advanceOf('A')).toBe(700);
    expect(font.advanceOf('a')).toBe(500);
  });

  it('substitutes the space advance for characters missing from the font', () => {
    expect(font.advanceOf('Z')).toBe(250);
    expect(font.advanceOf('é')).toBe(250);
  });

  it('rejects non-sfnt data', () => {
    expect(() => parseTtf(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]))).toThrow('not a TrueType/OpenType');
  });

  it('marks cmap-absent fonts instead of measuring silent zeros (F-TTFSILENT)', () => {
    const font = parseTtf(buildTestFont({ cmapFormat: 0 }));
    expect(font.cmapPresent).toBe(false);
    expect(font.advanceOf('A')).toBeUndefined();
    expect(parseTtf(buildTestFont()).cmapPresent).toBe(true);
  });

  it('throws on truncated table data instead of reading zeros (F-TTFSILENT)', () => {
    const full = buildTestFont();
    expect(() => parseTtf(full.slice(0, 40))).toThrow('truncated');
    expect(() => parseTtf(full.slice(0, full.length - 10))).toThrow('truncated');
  });
});

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

describe('Font metrics registry', () => {
  it('prefers the exact bold variant and falls back to regular', () => {
    const registry = new FontMetricsRegistry();
    registry.register(buildTestFont(), 'TestFont', 'regular');
    registry.register(buildTestFont({ weightClass: 700, advances: [[0, 0], [1, 250], [2, 740], [3, 520]] }), 'TestFont', 'bold');

    const regular = registry.resolve('TestFont', false)!;
    const bold = registry.resolve('TestFont', true)!;
    expect(regular.matchedVariant).toBe('regular');
    expect(bold.matchedVariant).toBe('bold');
    expect(bold.metrics.advanceOf('A')).toBe(740);
    expect(registry.resolve('TestFont', true, true)!.matchedVariant).toBe('regular'); // no boldItalic face
  });

  it('normalizes family names (case, quotes)', () => {
    const registry = new FontMetricsRegistry();
    registry.register(buildTestFont(), 'Test Font');
    expect(registry.resolve('"TEST FONT"')).toBeDefined();
    expect(registry.resolve('test font')).toBeDefined();
    expect(registry.resolve('Other')).toBeUndefined();
  });

  it('uses the name table family when no explicit name is given', () => {
    const registry = new FontMetricsRegistry();
    registry.register(buildTestFont({ familyName: 'NamedFont' }));
    expect(registry.resolve('NamedFont')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Measurer chain
// ---------------------------------------------------------------------------

describe('Font-aware text measurement', () => {
  it('layer 1 — uses real glyph advances for registered fonts', () => {
    const registry = new FontMetricsRegistry();
    registry.register(buildTestFont(), 'TestFont');
    const measurer = new SimpleTextMetricsMeasurer(registry);

    const result = measurer.measureText('Aa', { fontFamily: 'TestFont', fontSizePt: 10 });
    // (700 + 500) / 1000 * 10pt = 12pt
    expect(result.width).toBeCloseTo(12, 5);
    expect(result.ascent).toBeCloseTo(8, 5); // 800/1000 * 10
    expect(result.descent).toBeCloseTo(2, 5); // |-200|/1000 * 10
  });

  it('layer 1 — applies a synthetic-bold factor only when falling back to regular', () => {
    const registry = new FontMetricsRegistry();
    registry.register(buildTestFont(), 'TestFont');
    const measurer = new SimpleTextMetricsMeasurer(registry);

    const fallback = measurer.measureText('A', { fontFamily: 'TestFont', fontSizePt: 10, bold: true });
    expect(fallback.width).toBeCloseTo(7 * 1.06, 5); // regular face + 6% factor

    registry.register(buildTestFont({ weightClass: 700, advances: [[0, 0], [1, 250], [2, 740], [3, 500]] }), 'TestFont', 'bold');
    const exact = measurer.measureText('A', { fontFamily: 'TestFont', fontSizePt: 10, bold: true });
    expect(exact.width).toBeCloseTo(7.4, 5); // real bold face, no factor
  });

  it('layer 3 — falls back to the documented heuristic without fonts', () => {
    const measurer = new SimpleTextMetricsMeasurer(new FontMetricsRegistry());
    const result = measurer.measureText('A', { fontSizePt: 10 });
    expect(result.width).toBeCloseTo(6.8, 5); // 10 * 0.68 heuristic
  });

  it('layer 3 — uses heuristic widths openly for cmap-less fonts (F-TTFSILENT)', () => {
    const registry = new FontMetricsRegistry();
    registry.register(buildTestFont({ cmapFormat: 0, familyName: 'NoCmap' }), 'NoCmap');
    const measurer = new SimpleTextMetricsMeasurer(registry);
    const result = measurer.measureText('A', { fontFamily: 'NoCmap', fontSizePt: 10 });
    expect(result.width).toBeGreaterThan(0);
    expect(result.width).toBeCloseTo(6.8, 5); // same openly-heuristic width
  });

  it('measureTextWidth routes registered fonts through the chain', () => {
    const registry = globalFontMetrics;
    registry.register(buildTestFont(), 'ChainFont');
    try {
      // (700 + 500) / 1000 * 10pt = 12pt via real metrics, not the 0.52 heuristic.
      expect(measureTextWidth('Aa', 10, false, 'ChainFont')).toBeCloseTo(12, 5);
    } finally {
      registry.clear();
    }
  });

  it('keeps the monospace fixed-advance approximation when no real font exists', () => {
    expect(measureTextWidth('ab', 10, false, 'Courier New')).toBeCloseTo(12, 5); // 2 * 10 * 0.6
  });
});

describe('Canvas text measurement units', () => {
  const realDocument = (globalThis as unknown as { document?: unknown }).document;

  function stubCanvas(measured: { width: number; ascent: number; descent: number }) {
    const fakeContext = {
      font: '',
      measureText: (_text: string) => ({
        width: measured.width,
        fontBoundingBoxAscent: measured.ascent,
        fontBoundingBoxDescent: measured.descent,
      }),
    };
    (globalThis as unknown as { document?: unknown }).document = {
      createElement: (_tag: string) => ({ getContext: (_kind: string) => fakeContext }),
    };
    return fakeContext;
  }

  it('converts canvas CSS px back to layout pt (px * 72/96)', () => {
    // 12pt body text renders at 16px; a 96px-wide run must measure 72pt.
    const fake = stubCanvas({ width: 96, ascent: 76.8, descent: 19.2 });
    try {
      const measurer = new SimpleTextMetricsMeasurer(new FontMetricsRegistry());
      const result = measurer.measureText('sample', { fontFamily: 'UnregisteredFace', fontSizePt: 12 });
      expect(fake.font).toContain('12pt');
      expect(result.width).toBeCloseTo(72, 5); // 96 * 72/96
      expect(result.ascent).toBeCloseTo(57.6, 5); // 76.8 * 72/96
      expect(result.descent).toBeCloseTo(14.4, 5); // 19.2 * 72/96
      expect(result.height).toBeCloseTo(72, 5);
    } finally {
      (globalThis as unknown as { document?: unknown }).document = realDocument;
    }
  });

  it('skips the canvas layer when no font family is set (heuristic)', () => {
    stubCanvas({ width: 96, ascent: 76.8, descent: 19.2 });
    try {
      const measurer = new SimpleTextMetricsMeasurer(new FontMetricsRegistry());
      const result = measurer.measureText('A', { fontSizePt: 10 });
      expect(result.width).toBeCloseTo(6.8, 5); // heuristic, not 72pt
    } finally {
      (globalThis as unknown as { document?: unknown }).document = realDocument;
    }
  });
});

// ---------------------------------------------------------------------------
// Embedded fonts (ODTTF)
// ---------------------------------------------------------------------------

function buildFontPackage(fontBytes: Uint8Array): OpcPackage {
  const pkg = createPackage();
  const fontTableXml = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<w:fonts xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
    '  <w:font w:name="EmbeddedFont">',
    '    <w:embedRegular r:id="rId1" w:fontKey="{11223344-5566-7788-99AA-BBCCDDEEFF00}"/>',
    '  </w:font>',
    '</w:fonts>',
  ].join('\n');

  pkg.setPart({ name: 'word/fontTable.xml', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml', data: new TextEncoder().encode(fontTableXml) });
  pkg.setPart({ name: 'word/fonts/font1.odttf', contentType: 'application/vnd.openxmlformats-officedocument.obfuscatedFont', data: fontBytes });
  pkg.addRelationship('word/fontTable.xml', { id: 'rId1', type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/font', target: 'fonts/font1.odttf' });
  return pkg;
}

describe('Embedded font loading (ODTTF)', () => {
  it('deobfuscates the first 32 bytes with the reversed GUID key', () => {
    const plain = buildTestFont();
    const key = '{11223344-5566-7788-99AA-BBCCDDEEFF00}';
    const hex = '112233445566778899AABBCCDDEEFF00';
    const guid: number[] = [];
    for (let i = 0; i < 16; i++) guid.push(Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16));

    // Encrypt: XOR first 32 bytes with reversed GUID bytes.
    const obfuscated = plain.slice();
    for (let i = 0; i < 32; i++) obfuscated[i] = obfuscated[i]! ^ guid[15 - (i % 16)]!;

    // Bytes 32+ must be untouched; bytes 0-31 must differ.
    expect([...obfuscated.slice(32)]).toEqual([...plain.slice(32)]);
    expect([...obfuscated.slice(0, 32)]).not.toEqual([...plain.slice(0, 32)]);

    const restored = deobfuscateOdttf(obfuscated, key);
    expect([...restored]).toEqual([...plain]);
  });

  it('registers embedded fonts from a package for exact measurement', () => {
    const registry = new FontMetricsRegistry();
    const hex = '112233445566778899AABBCCDDEEFF00';
    const guid: number[] = [];
    for (let i = 0; i < 16; i++) guid.push(Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16));
    const plain = buildTestFont();
    const obfuscated = plain.slice();
    for (let i = 0; i < 32; i++) obfuscated[i] = obfuscated[i]! ^ guid[15 - (i % 16)]!;

    const count = loadEmbeddedFonts(buildFontPackage(obfuscated), registry);
    expect(count).toBe(1);
    expect(registry.resolve('EmbeddedFont')).toBeDefined();

    const measurer = new SimpleTextMetricsMeasurer(registry);
    const result = measurer.measureText('Aa', { fontFamily: 'EmbeddedFont', fontSizePt: 10 });
    expect(result.width).toBeCloseTo(12, 5);
  });

  it('returns 0 gracefully when the package has no font table', () => {
    const registry = new FontMetricsRegistry();
    expect(loadEmbeddedFonts(createPackage(), registry)).toBe(0);
  });
});
