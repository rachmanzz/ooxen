/**
 * Minimal TrueType/OpenType font metrics parser.
 *
 * Extracts only what text layout needs — vertical metrics and per-character
 * advance widths — from the `head`, `hhea`, `hmtx`, `cmap`, `OS/2`, and `name`
 * tables. Pure TypeScript over Uint8Array: runs identically in browsers,
 * Node.js, Bun, and workers with zero native dependencies (futures §5.2).
 *
 * Kerning is intentionally out of scope: advance widths are summed per
 * character, matching the resolution of the heuristic fallback it replaces.
 */

const SFNT_TRUE_TYPE = 0x00010000;
const SFNT_OPEN_TYPE_CFF = 0x4f54544f; // 'OTTO'
const SFNT_TRUE_TYPE_MAC = 0x74727565; // 'true'

export interface ParsedFontMetrics {
  /** Design units per em square (head.unitsPerEm), typically 1000–2048. */
  unitsPerEm: number;
  /** Ascender in font units (hhea.ascender), positive. */
  ascender: number;
  /** Descender in font units (hhea.descender), negative. */
  descender: number;
  /** OS/2 weight class when the OS/2 table is present (400 regular, 700 bold). */
  weightClass?: number;
  /** Family name from the name table (name id 1), when parseable. */
  familyName?: string;
  /** Advance width in font units for a character, or undefined when unmapped. */
  advanceOf(char: string): number | undefined;
}

function readUint16(data: Uint8Array, offset: number): number {
  return (data[offset]! << 8) | data[offset + 1]!;
}

function readInt16(data: Uint8Array, offset: number): number {
  const value = readUint16(data, offset);
  return value >= 0x8000 ? value - 0x10000 : value;
}

function readUint32(data: Uint8Array, offset: number): number {
  return ((data[offset]! << 24) | (data[offset + 1]! << 16) | (data[offset + 2]! << 8) | data[offset + 3]!) >>> 0;
}

/** cmap format 4 lookup (Windows Unicode BMP, the subtable every Word font has). */
class CmapFormat4 {
  constructor(
    private readonly data: Uint8Array,
    private readonly segCount: number,
    private readonly endCodesOffset: number,
    private readonly startCodesOffset: number,
    private readonly idDeltasOffset: number,
    private readonly idRangeOffsetsOffset: number,
  ) {}

  glyphId(charCode: number): number | undefined {
    for (let seg = 0; seg < this.segCount; seg++) {
      const end = readUint16(this.data, this.endCodesOffset + seg * 2);
      if (charCode > end) continue;
      const start = readUint16(this.data, this.startCodesOffset + seg * 2);
      if (charCode < start) return undefined;
      const idRangeOffsetAddr = this.idRangeOffsetsOffset + seg * 2;
      const idRangeOffset = readUint16(this.data, idRangeOffsetAddr);
      if (idRangeOffset === 0) {
        return (charCode + readInt16(this.data, this.idDeltasOffset + seg * 2)) & 0xffff;
      }
      const glyphIndexAddr = idRangeOffsetAddr + idRangeOffset + (charCode - start) * 2;
      const glyphIndex = readUint16(this.data, glyphIndexAddr);
      if (glyphIndex === 0) return undefined;
      return (glyphIndex + readInt16(this.data, this.idDeltasOffset + seg * 2)) & 0xffff;
    }
    return undefined;
  }
}

export function parseTtf(data: Uint8Array): ParsedFontMetrics {
  if (data.length < 12) throw new Error('Invalid font: too short');
  const sfntVersion = readUint32(data, 0);
  if (sfntVersion !== SFNT_TRUE_TYPE && sfntVersion !== SFNT_OPEN_TYPE_CFF && sfntVersion !== SFNT_TRUE_TYPE_MAC) {
    throw new Error('Invalid font: not a TrueType/OpenType sfnt container');
  }

  const numTables = readUint16(data, 4);
  const tables = new Map<string, { offset: number; length: number }>();
  for (let i = 0; i < numTables; i++) {
    const record = 12 + i * 16;
    const tag = String.fromCharCode(data[record]!, data[record + 1]!, data[record + 2]!, data[record + 3]!);
    tables.set(tag, { offset: readUint32(data, record + 8), length: readUint32(data, record + 12) });
  }

  const head = tables.get('head');
  if (!head) throw new Error('Invalid font: missing head table');
  const unitsPerEm = readUint16(data, head.offset + 18);
  if (unitsPerEm === 0) throw new Error('Invalid font: unitsPerEm is zero');

  const hhea = tables.get('hhea');
  const hmtx = tables.get('hmtx');
  const cmap = tables.get('cmap');

  const ascender = hhea ? readInt16(data, hhea.offset + 4) : Math.round(unitsPerEm * 0.8);
  const descender = hhea ? readInt16(data, hhea.offset + 6) : -Math.round(unitsPerEm * 0.2);
  const numberOfHMetrics = hhea ? readUint16(data, hhea.offset + 34) : 0;

  const os2 = tables.get('OS/2');
  const weightClass = os2 ? readUint16(data, os2.offset + 4) : undefined;

  const familyName = readFamilyName(data, tables.get('name')?.offset);

  // Locate the best Unicode cmap subtable: Windows Unicode BMP (3/1) first,
  // then any platform-0 subtable.
  let cmapTable: CmapFormat4 | undefined;
  if (cmap) {
    const subtableCount = readUint16(data, cmap.offset + 2);
    let fallbackSubtable: number | undefined;
    for (let i = 0; i < subtableCount; i++) {
      const record = cmap.offset + 4 + i * 8;
      const platformId = readUint16(data, record);
      const encodingId = readUint16(data, record + 2);
      const subtableOffset = cmap.offset + readUint32(data, record + 4);
      if (platformId === 3 && (encodingId === 1 || encodingId === 10)) {
        fallbackSubtable = subtableOffset;
        if (encodingId === 1) break;
      } else if (platformId === 0) {
        fallbackSubtable = fallbackSubtable ?? subtableOffset;
      }
    }
    if (fallbackSubtable !== undefined && readUint16(data, fallbackSubtable) === 4) {
      const segCountX2 = readUint16(data, fallbackSubtable + 6);
      const segCount = segCountX2 / 2;
      const endCodesOffset = fallbackSubtable + 14;
      const startCodesOffset = endCodesOffset + segCountX2 + 2;
      const idDeltasOffset = startCodesOffset + segCountX2;
      const idRangeOffsetsOffset = idDeltasOffset + segCountX2;
      cmapTable = new CmapFormat4(data, segCount, endCodesOffset, startCodesOffset, idDeltasOffset, idRangeOffsetsOffset);
    }
  }

  const spaceAdvance = glyphAdvance(data, hmtx, numberOfHMetrics, cmapTable, 0x20);

  return {
    unitsPerEm,
    ascender,
    descender,
    weightClass,
    familyName,
    advanceOf(char: string): number | undefined {
      const codePoint = char.codePointAt(0);
      if (codePoint === undefined) return undefined;
      const advance = glyphAdvance(data, hmtx, numberOfHMetrics, cmapTable, codePoint);
      // Characters missing from the font map to the space advance — the
      // standard substitution behavior for measurement purposes.
      return advance ?? spaceAdvance;
    },
  };
}

function glyphAdvance(
  data: Uint8Array,
  hmtx: { offset: number; length: number } | undefined,
  numberOfHMetrics: number,
  cmap: CmapFormat4 | undefined,
  codePoint: number,
): number | undefined {
  if (!hmtx || !cmap || numberOfHMetrics === 0) return undefined;
  const glyphId = cmap.glyphId(codePoint);
  if (glyphId === undefined || glyphId === 0) return undefined;
  const index = Math.min(glyphId, numberOfHMetrics - 1);
  return readUint16(data, hmtx.offset + index * 4);
}

function readFamilyName(data: Uint8Array, nameOffset: number | undefined): string | undefined {
  if (!nameOffset) return undefined;
  try {
    const count = readUint16(data, nameOffset + 2);
    const stringOffset = nameOffset + readUint16(data, nameOffset + 4);
    // Prefer Windows Unicode (platform 3) English (0x409), then platform 1 Mac Roman.
    let macFallback: { length: number; offset: number } | undefined;
    for (let i = 0; i < count; i++) {
      const record = nameOffset + 6 + i * 12;
      const platformId = readUint16(data, record);
      const nameId = readUint16(data, record + 6);
      if (nameId !== 1) continue;
      const length = readUint16(data, record + 8);
      const offset = readUint16(data, record + 10);
      if (platformId === 3) {
        const start = stringOffset + offset;
        let name = '';
        for (let c = 0; c < length; c += 2) name += String.fromCharCode(readUint16(data, start + c));
        return name;
      }
      if (platformId === 1) macFallback = { length, offset: stringOffset + offset };
    }
    if (macFallback) {
      let name = '';
      for (let c = 0; c < macFallback.length; c++) name += String.fromCharCode(data[macFallback.offset + c]!);
      return name;
    }
  } catch {
    // Name table is optional for measurement purposes.
  }
  return undefined;
}
