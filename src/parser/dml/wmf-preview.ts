/**
 * Equation Editor (OLE) preview rendering (F-WMFEQ).
 *
 * Legacy `Equation.3` objects embed a WMF metafile preview
 * (`v:imagedata` → `word/media/*.wmf`) that browsers cannot decode, so
 * the equation degraded to an empty gray placeholder. This module parses
 * the subset of WMF records MathType-style previews use (fonts, absolute
 * text runs, straight rules) and re-emits them as SVG, which every
 * renderer in this repo can draw. The AST keeps the original WMF bytes,
 * so serialization round-trips byte-identically.
 *
 * Text positions and sizes come straight from the metafile; only the
 * MathType display face is approximated (serif italic), since that font
 * is not licensable on viewer machines.
 */

interface WmfFont {
  face: string;
  heightUnits: number;
  italic: boolean;
}

/**
 * One slot of the WMF object table. Every Create* record (font, pen,
 * brush, palette, region, pattern brush) takes the lowest free slot and
 * DeleteObject frees one, so SelectObject indices only line up when all
 * of them are tracked, not just fonts (MS-WMF §3.1.4.1).
 */
type WmfObject =
  | { kind: 'font'; font: WmfFont }
  | { kind: 'pen'; color: string; widthUnits: number }
  | { kind: 'other' };

// MS-WMF §2.1.1.1 RecordType values.
const META_SETBKMODE = 0x0102;
const META_SETMAPMODE = 0x0103;
const META_SETTEXTALIGN = 0x012e;
const META_SELECTOBJECT = 0x012d;
const META_DELETEOBJECT = 0x01f0;
const META_CREATEPATTERNBRUSH = 0x01f9;
const META_DIBCREATEPATTERNBRUSH = 0x0142;
const META_CREATEPALETTE = 0x00f7;
const META_SETBKCOLOR = 0x0201;
const META_SETTEXTCOLOR = 0x0209;
const META_SETWINDOWORG = 0x020b;
const META_SETWINDOWEXT = 0x020c;
const META_SETVIEWPORTORG = 0x020d;
const META_SETVIEWPORTEXT = 0x020e;
const META_LINETO = 0x0213;
const META_MOVETO = 0x0214;
const META_CREATEPENINDIRECT = 0x02fa;
const META_CREATEFONTINDIRECT = 0x02fb;
const META_CREATEBRUSHINDIRECT = 0x02fc;
const META_TEXTOUT = 0x0521;
const META_ESCAPE = 0x0626;
const META_CREATEREGION = 0x06ff;
const META_EXTTEXTOUT = 0x0a32;

const previewCache = new WeakMap<object, WmfPreview | null>();

/**
 * Parsed WMF preview for an image node, memoized. Canvas renderers draw
 * this vector model directly (browsers cannot decode WMF); the AST
 * keeps the original bytes.
 */
export function previewWmfImage(image: { data?: Uint8Array }): WmfPreview | undefined {
  const data = image.data;
  if (!data || data.length < 22) return undefined;
  if (!previewCache.has(image)) {
    previewCache.set(image, parseWmfPreview(data) ?? null);
  }
  return previewCache.get(image) ?? undefined;
}

export interface WmfPreviewText {
  x: number;
  y: number;
  sizePt: number;
  face: string;
  italic: boolean;
  color: string;
  text: string;
}

export interface WmfPreviewLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  widthPt: number;
}

export interface WmfPreview {
  widthPt: number;
  heightPt: number;
  texts: WmfPreviewText[];
  lines: WmfPreviewLine[];
}

const PLACEABLE_MAGIC = 0x9ac6cdd7;

/** True for placeable or bare Windows metafiles. */
export function isWmfMetafile(data: Uint8Array): boolean {
  if (data.length < 4) return false;
  const magic =
    (data[0]! | (data[1]! << 8) | (data[2]! << 16) | (data[3]! << 24)) >>> 0;
  if (magic === PLACEABLE_MAGIC) return data.length >= 22;
  // Bare metafile: type 1 (disk) or 2 (memory), version 0x0300.
  return data.length >= 18 && data[0]! <= 2 && data[4]! === 0x00 && data[5]! === 0x03;
}

function u16(data: Uint8Array, off: number): number {
  return data[off]! | (data[off + 1]! << 8);
}

function i16(data: Uint8Array, off: number): number {
  const v = u16(data, off);
  return v >= 0x8000 ? v - 0x10000 : v;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** COLORREF 0x00BBGGRR is little-endian on disk, so bytes arrive R, G, B. */
function colorRefToHex(r: number, g: number, b: number): string {
  const hex = (v: number): string => v.toString(16).padStart(2, '0').toUpperCase();
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

function mapFontFace(face: string): { face: string; forceItalic: boolean } {
  const lower = face.toLowerCase();
  if (lower === 'mathtype' || lower === 'mt extra') {
    return { face: "'Times New Roman', serif", forceItalic: true };
  }
  if (lower === 'symbol' || lower === 'mt symbol') return { face: 'Symbol', forceItalic: false };
  return { face: `'${face.replace(/'/g, '')}', serif`, forceItalic: false };
}

/**
 * Parses a WMF preview into positioned text runs and rules, normalized
 * to the content origin with point sizes. Unknown records are skipped by
 * their declared size; parsing stops at the first structurally invalid
 * record.
 */
export function parseWmfPreview(data: Uint8Array): WmfPreview | undefined {
  if (!isWmfMetafile(data)) return undefined;

  let inch = 1440;
  let bounds: { left: number; top: number; right: number; bottom: number } | undefined;
  let cursor: number;
  if (
    data.length >= 22 &&
    (data[0]! | (data[1]! << 8) | (data[2]! << 16) | (data[3]! << 24)) >>> 0 === PLACEABLE_MAGIC
  ) {
    // Coordinates are signed INT16 (MS-WMF §2.2.2.18): equation previews
    // routinely put the origin on the baseline, so top/left go negative.
    bounds = {
      left: i16(data, 6),
      top: i16(data, 8),
      right: i16(data, 10),
      bottom: i16(data, 12),
    };
    inch = u16(data, 14) || 1440;
    cursor = 22;
    // The placeable header is followed by the 18-byte META_HEADER
    // (type, header size 9 words, version 0x0300, ...; MS-WMF §2.3.2.2)
    // before the first record. Skip it when present; a writer that omits
    // it starts records right at 22.
    if (
      data.length >= 40 &&
      (data[22] === 1 || data[22] === 2) &&
      data[23] === 0 &&
      u16(data, 24) === 9 &&
      u16(data, 26) === 0x0300
    ) {
      cursor = 40;
    }
  } else {
    cursor = 18;
  }
  const toPt = 72 / inch;

  const objects: (WmfObject | undefined)[] = [];
  const createObject = (obj: WmfObject): void => {
    const free = objects.indexOf(undefined);
    if (free >= 0) objects[free] = obj;
    else objects.push(obj);
  };
  let selectedFont: WmfFont | undefined;
  // TA_* flags (MS-WMF §2.1.2.3). Vertical bits: TA_TOP 0 (default),
  // TA_BOTTOM 8, TA_BASELINE 24. Runs are normalized to baseline y.
  let textAlign = 0;
  let textColor = '#000000';
  let penColor = '#000000';
  let penWidthUnits = 1;
  let posX = 0;
  let posY = 0;
  const texts: WmfPreviewText[] = [];
  const lines: WmfPreviewLine[] = [];

  const recordAt = (off: number): { size: number; func: number } | undefined => {
    if (off + 6 > data.length) return undefined;
    const size = data[off]! | (data[off + 1]! << 8) | (data[off + 2]! << 16) | (data[off + 3]! << 24);
    const func = data[off + 4]! | (data[off + 5]! << 8);
    // RecordSize is a UINT32 in words; large records (MathType MTEF
    // comments, DIBs) are legitimate and simply skipped by size.
    if (size < 3 || off + size * 2 > data.length) return undefined;
    return { size, func };
  };

  // The placeable header of some writers is followed by padding before the
  // first record; resynchronize by scanning for the next sane record.
  const KNOWN = new Set([
    META_SETBKMODE,
    META_SETMAPMODE,
    META_SETTEXTALIGN,
    META_SELECTOBJECT,
    META_DELETEOBJECT,
    META_SETBKCOLOR,
    META_SETTEXTCOLOR,
    META_SETWINDOWORG,
    META_SETWINDOWEXT,
    META_SETVIEWPORTORG,
    META_SETVIEWPORTEXT,
    META_LINETO,
    META_MOVETO,
    META_CREATEPENINDIRECT,
    META_CREATEFONTINDIRECT,
    META_CREATEBRUSHINDIRECT,
    META_TEXTOUT,
    META_ESCAPE,
    META_EXTTEXTOUT,
  ]);
  let guard = 0;
  while (cursor + 6 <= data.length && guard++ < 10000) {
    let rec = recordAt(cursor);
    if (!rec) {
      let found = -1;
      for (let probe = cursor + 2; probe + 6 <= data.length && probe < cursor + 256; probe += 2) {
        const candidate = recordAt(probe);
        if (candidate && KNOWN.has(candidate.func)) {
          found = probe;
          break;
        }
      }
      if (found < 0) break;
      cursor = found;
      rec = recordAt(cursor)!;
    }
    const end = cursor + rec.size * 2;
    const p = cursor + 6; // params start
    switch (rec.func) {
      case META_CREATEFONTINDIRECT: {
        // LOGFONT16 height/italic/face. A short record still takes a slot
        // so later SelectObject indices stay aligned.
        if (end - p >= 50) {
          const height = Math.abs(i16(data, p)) || 200;
          const italic = data[p + 10] !== 0;
          let faceEnd = p + 18;
          while (faceEnd < p + 50 && data[faceEnd] !== 0) faceEnd++;
          const faceBytes = data.slice(p + 18, faceEnd);
          let face = '';
          for (const b of faceBytes) face += String.fromCharCode(b);
          createObject({ kind: 'font', font: { face: face || 'Times New Roman', heightUnits: height, italic } });
        } else {
          createObject({ kind: 'other' });
        }
        break;
      }
      case META_CREATEPENINDIRECT: {
        // LOGPEN16: style (2), width x/y (4), COLORREF (4) = 10 bytes.
        if (end - p >= 10) {
          createObject({
            kind: 'pen',
            widthUnits: u16(data, p + 2) || 1,
            color: colorRefToHex(data[p + 6]!, data[p + 7]!, data[p + 8]!),
          });
        } else {
          createObject({ kind: 'other' });
        }
        break;
      }
      case META_CREATEBRUSHINDIRECT:
      case META_CREATEPALETTE:
      case META_CREATEPATTERNBRUSH:
      case META_DIBCREATEPATTERNBRUSH:
      case META_CREATEREGION: {
        // Not drawn by the preview, but each one occupies a table slot.
        createObject({ kind: 'other' });
        break;
      }
      case META_SELECTOBJECT: {
        // Index into the object table; fonts drive text, pens drive rules.
        if (end - p >= 2) {
          const obj = objects[u16(data, p)];
          if (obj?.kind === 'font') selectedFont = obj.font;
          else if (obj?.kind === 'pen') {
            penColor = obj.color;
            penWidthUnits = obj.widthUnits;
          }
        }
        break;
      }
      case META_DELETEOBJECT: {
        // Frees the slot; the next Create* reuses the lowest free index.
        if (end - p >= 2) {
          const index = u16(data, p);
          if (index < objects.length) objects[index] = undefined;
        }
        break;
      }
      case META_SETTEXTALIGN: {
        if (end - p >= 2) textAlign = u16(data, p);
        break;
      }
      case META_SETTEXTCOLOR: {
        // COLORREF 0x00BBGGRR.
        if (end - p >= 4) textColor = colorRefToHex(data[p]!, data[p + 1]!, data[p + 2]!);
        break;
      }
      case META_EXTTEXTOUT:
      case META_TEXTOUT: {
        // ExtTextOut: y, x, count, options, [rect], string (MS-WMF
        // §2.3.3.5). TextOut: count, string (even-padded), y, x
        // (§2.3.3.20). The count field is authoritative: writers pad the
        // record with extra bytes (e.g. a two-byte "Sy" with count 1
        // renders as "S"), so only count bytes are drawn, never the
        // padded remainder.
        let x: number;
        let y: number;
        let count: number;
        let strStart: number;
        if (rec.func === META_EXTTEXTOUT) {
          if (end - p < 8) break;
          y = i16(data, p);
          x = i16(data, p + 2);
          count = u16(data, p + 4);
          strStart = p + 8;
          // ETO_OPAQUE (0x02) / ETO_CLIPPED (0x04) insert an 8-byte
          // Rectangle before the string (§2.3.3.5).
          if (u16(data, p + 6) & 0x06) strStart += 8;
          if (strStart > end) break;
        } else {
          if (end - p < 6) break;
          count = u16(data, p);
          strStart = p + 2;
          const padded = count + (count & 1);
          if (end - strStart < padded + 4) break;
          y = i16(data, strStart + padded);
          x = i16(data, strStart + padded + 2);
        }
        const strEnd = Math.min(end, strStart + count);
        let text = '';
        for (let i = strStart; i < strEnd; i++) {
          const code = data[i]!;
          if (code === 0x00) break;
          text += String.fromCharCode(code);
        }
        const font = selectedFont;
        const sizePt = font && font.heightUnits > 0 ? font.heightUnits * toPt : 12;
        const mapped = mapFontFace(font?.face ?? 'Times New Roman');
        // Convert the reference point to the baseline, which is what the
        // SVG emitter and canvas painter draw at: TA_TOP (the default)
        // addresses the glyph cell top, TA_BOTTOM its bottom.
        const sizeUnits = sizePt / toPt;
        const vertical = textAlign & 0x18;
        const baselineY = vertical === 0x18 ? y : vertical === 0x08 ? y - sizeUnits * 0.2 : y + sizeUnits * 0.8;
        if (text.length > 0) {
          texts.push({
            x,
            y: baselineY,
            sizePt,
            face: mapped.face,
            italic: Boolean(font?.italic) || mapped.forceItalic,
            color: textColor,
            text,
          });
        }
        break;
      }
      case META_MOVETO: {
        // y, x.
        if (end - p >= 4) {
          posY = i16(data, p);
          posX = i16(data, p + 2);
        }
        break;
      }
      case META_LINETO: {
        // y, x draws from the current position.
        if (end - p >= 4) {
          const y = i16(data, p);
          const x = i16(data, p + 2);
          lines.push({
            x1: posX,
            y1: posY,
            x2: x,
            y2: y,
            color: penColor,
            widthPt: Math.max(0.75, penWidthUnits * toPt),
          });
          posX = x;
          posY = y;
        }
        break;
      }
      default:
        break;
    }
    cursor = end;
  }

  if (texts.length === 0 && lines.length === 0) return undefined;

  let left = bounds?.left ?? 0;
  let top = bounds?.top ?? 0;
  let right = bounds?.right ?? 0;
  let bottom = bounds?.bottom ?? 0;
  if (!bounds || right <= left || bottom <= top) {
    left = top = Number.MAX_SAFE_INTEGER;
    right = bottom = Number.MIN_SAFE_INTEGER;
    for (const t of texts) {
      // t.y is the baseline: the cell spans ascent above, descent below.
      const units = t.sizePt / toPt;
      left = Math.min(left, t.x);
      top = Math.min(top, t.y - units * 0.8);
      right = Math.max(right, t.x + units * t.text.length * 0.6);
      bottom = Math.max(bottom, t.y + units * 0.2);
    }
    for (const l of lines) {
      left = Math.min(left, l.x1, l.x2);
      top = Math.min(top, l.y1, l.y2);
      right = Math.max(right, l.x1, l.x2);
      bottom = Math.max(bottom, l.y1, l.y2);
    }
  }
  const widthPt = Math.max(1, (right - left) * toPt);
  const heightPt = Math.max(1, (bottom - top) * toPt);
  // Normalize to point space relative to the content origin so both the
  // SVG emitter and the canvas painter share one coordinate system.
  for (const t of texts) {
    t.x = (t.x - left) * toPt;
    t.y = (t.y - top) * toPt;
  }
  for (const l of lines) {
    l.x1 = (l.x1 - left) * toPt;
    l.y1 = (l.y1 - top) * toPt;
    l.x2 = (l.x2 - left) * toPt;
    l.y2 = (l.y2 - top) * toPt;
  }
  return { widthPt, heightPt, texts, lines };
}

const round2 = (v: number): string => (Math.round(v * 100) / 100).toString();

/** Renders a parsed WMF preview as SVG (used by the HTML renderer). */
export function convertWmfToSvg(data: Uint8Array): string | undefined {
  const preview = parseWmfPreview(data);
  return preview ? previewToSvg(preview) : undefined;
}

function previewToSvg(preview: WmfPreview): string {
  const parts: string[] = [];
  for (const l of preview.lines) {
    parts.push(
      `<line x1="${l.x1}" y1="${l.y1}" x2="${l.x2}" y2="${l.y2}" stroke="${l.color}" stroke-width="${round2(l.widthPt)}"/>`,
    );
  }
  for (const t of preview.texts) {
    const slant = t.italic ? ' font-style="italic"' : '';
    // Equation previews address text by baseline (the descender of the
    // lowest run kisses the metafile bbox bottom); there is no ascent
    // offset unlike TA_TOP-positioned text.
    parts.push(
      `<text x="${t.x}" y="${round2(t.y)}" font-size="${round2(t.sizePt)}" font-family="${t.face}" fill="${t.color}"${slant}>${escapeXml(t.text)}</text>`,
    );
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${round2(preview.widthPt)} ${round2(preview.heightPt)}" ` +
    `width="${round2(preview.widthPt)}pt" height="${round2(preview.heightPt)}pt">${parts.join('')}</svg>`
  );
}

/**
 * SVG data URL for a WMF-backed image, or undefined when the bytes are
 * not a convertible metafile. Renderers use this in place of the
 * undecodable WMF `src`; the AST keeps the original bytes.
 */
export function wmfPreviewDataUrl(image: { data?: Uint8Array }): string | undefined {
  // Shares the per-image parse cache with the canvas path, so repeated
  // HTML renders do not re-decode the metafile.
  const preview = previewWmfImage(image);
  if (!preview) return undefined;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(previewToSvg(preview))}`;
}
