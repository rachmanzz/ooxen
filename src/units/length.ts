/**
 * Single source of truth for length-unit conversion.
 *
 * OOXML mixes units per construct (twips, half-points, EMUs, 240ths of a
 * line, 50ths of a percent) while layout runs in points and the screen in
 * CSS px. Every conversion between those worlds must go through this module
 * so the direction (multiply vs divide) is reviewed once, tested once, and
 * never re-derived ad hoc at a call site (the px↔pt inversions behind the
 * rendering roast lived in two such ad-hoc spots).
 */

/** Length units accepted anywhere in this module. */
export type LengthUnit =
  | 'twip' // twentieth of a point (most w:* measurements)
  | 'dxa' // twentieth of a point (table/cell measurements; same as twip)
  | 'halfPoint' // eighths of a point in name only: w:sz values (half a point)
  | 'emu' // English Metric Unit, DrawingML extents (1pt = 12700 EMU)
  | 'pt' // point (layout geometry)
  | 'px' // CSS px at the reference DPI
  | 'inch' // inch
  | 'cm'; // centimeter

/** Reference pixel density for px. Browsers use 96. */
export const REFERENCE_DPI = 96;

/** Points per inch, by definition. */
export const PT_PER_INCH = 72;

/** Twips (twentieths of a point) per point. */
export const TWIPS_PER_PT = 20;

/** EMUs per point (914400 per inch / 72). */
export const EMU_PER_PT = 12700;

/** Half-points per point (w:sz unit). */
export const HALF_POINTS_PER_PT = 2;

/** 240ths of a line per whole line (auto spacing rule unit). */
export const LINE_240_PER_LINE = 240;

/** 50ths of a percent per whole (w:tblW pct unit). */
export const PCT_50_PER_WHOLE = 50;

/** Absolute height of one auto-spaced line when the run font is unknown. */
export const DEFAULT_SINGLE_LINE_PT = 13.2;

function toPt(value: number, unit: LengthUnit, dpi: number): number {
  switch (unit) {
    case 'twip':
    case 'dxa':
      return value / TWIPS_PER_PT;
    case 'halfPoint':
      return value / HALF_POINTS_PER_PT;
    case 'emu':
      return value / EMU_PER_PT;
    case 'pt':
      return value;
    case 'px':
      return (value * PT_PER_INCH) / dpi;
    case 'inch':
      return value * PT_PER_INCH;
    case 'cm':
      return (value * PT_PER_INCH) / 2.54;
  }
}

/**
 * Converts any supported length unit to CSS px.
 * Direction is fixed: px is always the *output*, so a caller can never
 * accidentally multiply where it must divide.
 */
export function toPx(value: number, unit: LengthUnit, dpi: number = REFERENCE_DPI): number {
  if (unit === 'px') return value;
  return (toPt(value, unit, dpi) * dpi) / PT_PER_INCH;
}

function fromPt(valuePt: number, unit: LengthUnit, dpi: number): number {
  switch (unit) {
    case 'twip':
    case 'dxa':
      return valuePt * TWIPS_PER_PT;
    case 'halfPoint':
      return valuePt * HALF_POINTS_PER_PT;
    case 'emu':
      return valuePt * EMU_PER_PT;
    case 'pt':
      return valuePt;
    case 'px':
      return (valuePt * dpi) / PT_PER_INCH;
    case 'inch':
      return valuePt / PT_PER_INCH;
    case 'cm':
      return (valuePt * 2.54) / PT_PER_INCH;
  }
}

/**
 * Converts CSS px to any supported length unit.
 * Direction is fixed: px is always the *input*.
 */
export function fromPx(px: number, unit: LengthUnit, dpi: number = REFERENCE_DPI): number {
  if (unit === 'px') return px;
  return fromPt((px * PT_PER_INCH) / dpi, unit, dpi);
}

/**
 * Converts an auto-rule spacing value (240ths of a line) to points.
 * `singleLinePt` is the absolute height of one line; callers that know the
 * run font should pass its measured single-line height instead of the
 * document-agnostic default.
 */
export function line240ToPt(value: number, singleLinePt: number = DEFAULT_SINGLE_LINE_PT): number {
  return (value / LINE_240_PER_LINE) * singleLinePt;
}

/**
 * Converts a 50ths-of-a-percent width (w:tblW pct) to points against a base.
 */
export function pct50ToPt(value: number, basePt: number): number {
  return (value / PCT_50_PER_WHOLE / 100) * basePt;
}
