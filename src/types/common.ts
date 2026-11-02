/**
 * Unit conversion and geometric primitives for OOXML and Canvas.
 * Standard OOXML units:
 * - 1 inch = 72 points (pt)
 * - 1 point = 20 twips (twip = twentieth of a point)
 * - 1 inch = 1440 twips
 * - 1 inch = 914400 EMUs (English Metric Units, used in DrawingML)
 * - 1 point = 12700 EMUs
 */

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Rect extends Point, Size {}

export interface Margins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Convert twips to points (pt) */
export function twipsToPt(twips: number): number {
  return twips / 20;
}

/** Convert points (pt) to twips */
export function ptToTwips(pt: number): number {
  return pt * 20;
}

/** Convert points (pt) to pixels at a given DPI (default 96) */
export function ptToPx(pt: number, dpi: number = 96): number {
  return (pt * dpi) / 72;
}

/** Convert pixels to points (pt) at a given DPI (default 96) */
export function pxToPt(px: number, dpi: number = 96): number {
  return (px * 72) / dpi;
}

/** Convert EMUs to points (pt) */
export function emuToPt(emu: number): number {
  return emu / 12700;
}

/** Convert points (pt) to EMUs */
export function ptToEmu(pt: number): number {
  return pt * 12700;
}

const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Universal runtime-agnostic base64 encoder for Uint8Array (no Node.js Buffer).
 */
export function uint8ArrayToBase64(bytes: Uint8Array): string {
  if (typeof globalThis.btoa === 'function') {
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]!);
    }
    return globalThis.btoa(binary);
  }

  let base64 = '';
  const len = bytes.length;
  for (let i = 0; i < len; i += 3) {
    const b0 = bytes[i]!;
    const b1 = i + 1 < len ? bytes[i + 1]! : 0;
    const b2 = i + 2 < len ? bytes[i + 2]! : 0;

    base64 += B64_CHARS[(b0 >> 2) & 0x3f];
    base64 += B64_CHARS[((b0 & 0x03) << 4) | ((b1 >> 4) & 0x0f)];
    base64 += i + 1 < len ? B64_CHARS[((b1 & 0x0f) << 2) | ((b2 >> 6) & 0x03)] : '=';
    base64 += i + 2 < len ? B64_CHARS[b2 & 0x3f] : '=';
  }
  return base64;
}

/**
 * Universal runtime-agnostic base64 decoder to Uint8Array (no Node.js Buffer).
 */
export function base64ToUint8Array(base64: string): Uint8Array {
  const clean = base64.replace(/^data:[^;]+;base64,/, '').trim();
  if (typeof globalThis.atob === 'function') {
    const binary = globalThis.atob(clean);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  const b64Map = new Map<string, number>();
  for (let i = 0; i < B64_CHARS.length; i++) {
    b64Map.set(B64_CHARS[i]!, i);
  }

  const raw = clean.replace(/=+$/, '');
  const bytes = new Uint8Array(Math.floor((raw.length * 3) / 4));
  let byteIndex = 0;

  for (let i = 0; i < raw.length; i += 4) {
    const c0 = b64Map.get(raw[i]!) ?? 0;
    const c1 = b64Map.get(raw[i + 1]!) ?? 0;
    const c2 = b64Map.get(raw[i + 2]!) ?? 0;
    const c3 = b64Map.get(raw[i + 3]!) ?? 0;

    bytes[byteIndex++] = (c0 << 2) | (c1 >> 4);
    if (i + 2 < raw.length) bytes[byteIndex++] = ((c1 & 0x0f) << 4) | (c2 >> 2);
    if (i + 3 < raw.length) bytes[byteIndex++] = ((c2 & 0x03) << 6) | c3;
  }
  return bytes;
}
