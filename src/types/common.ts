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
