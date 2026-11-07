import { describe, expect, it } from 'bun:test';
import {
  fromPx,
  line240ToPt,
  pct50ToPt,
  toPx,
  type LengthUnit,
} from '../../src/units/length.js';

describe('Unit converter (length)', () => {
  it('routes every absolute unit through the same pt pivot', () => {
    const cases: Array<[LengthUnit, number, number]> = [
      ['twip', 20, 1], // 20 twips = 1pt
      ['dxa', 20, 1], // dxa is twips under another name
      ['halfPoint', 2, 1], // w:sz half-points
      ['emu', 12700, 1], // DrawingML extents
      ['pt', 11, 11],
      ['inch', 1, 72],
      ['cm', 2.54, 72],
    ];
    for (const [unit, input, expectedPt] of cases) {
      // 1pt renders as 96/72 px, so expected px is scaled from pt.
      expect(toPx(input, unit)).toBeCloseTo((expectedPt * 96) / 72, 8);
      expect(toPx(expectedPt, 'pt')).toBeCloseTo((expectedPt * 96) / 72, 8);
    }
  });

  it('never inverts the px direction (the rendering-roast regression)', () => {
    // Canvas measureText reports CSS px; layout is pt. 96px wide MUST be
    // 72pt — the old ad-hoc code produced 128pt by multiplying instead.
    expect(fromPx(96, 'pt')).toBeCloseTo(72, 8);
    expect(toPx(72, 'pt')).toBeCloseTo(96, 8);
    // Round-trip every unit through px and back.
    const units: LengthUnit[] = ['twip', 'dxa', 'halfPoint', 'emu', 'pt', 'inch', 'cm'];
    for (const unit of units) {
      expect(fromPx(toPx(123.456, unit), unit)).toBeCloseTo(123.456, 8);
    }
  });

  it('converts contextual units with an explicit base', () => {
    // Auto spacing: 240/240 of the default single line ≈ 13.2pt.
    expect(line240ToPt(240)).toBeCloseTo(13.2, 8);
    expect(line240ToPt(276, 13.2)).toBeCloseTo(15.18, 8);
    // Table width pct: 5000/50 = 100% of the base.
    expect(pct50ToPt(5000, 468)).toBeCloseTo(468, 8);
    expect(pct50ToPt(2500, 468)).toBeCloseTo(234, 8);
  });

  it('honors a non-default DPI both ways', () => {
    expect(toPx(72, 'pt', 144)).toBeCloseTo(144, 8);
    expect(fromPx(144, 'pt', 144)).toBeCloseTo(72, 8);
  });
});
