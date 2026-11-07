import { globalFontMetrics, type FontMetricsRegistry, type FontVariantMatch } from '../fonts/font-metrics-registry.js';
import { fromPx } from '../units/length.js';
import type { TextStyle } from '../types/style.js';

/**
 * Universal text metrics measurement abstraction.
 */

export interface TextMetricsResult {
  width: number;
  height: number;
  ascent: number;
  descent: number;
}

export interface TextMetricsMeasurer {
  measureText(text: string, style?: TextStyle): TextMetricsResult;
}

/**
 * Canvas `measureText` reports CSS px while layout geometry is in points.
 * Convert with `fromPx` (px * 72/96 at 96 DPI) — never the inverse.
 */

/**
 * Text measurer with a three-layer resolution chain (futures §5.2, roast v1 F6):
 *
 * 1. Real font metrics — a registered TTF/OTF (e.g. embedded in the DOCX) is
 *    parsed for `hmtx`/`cmap` advance widths and `hhea` vertical metrics.
 * 2. `canvas.measureText` — used when a DOM canvas is available (browsers).
 * 3. Per-character heuristic — the original 0.6em-class approximation, kept as
 *    the last resort for canvas-less, font-less environments.
 *
 * Runs anywhere (Browser, Node.js, Bun, Web Worker) with zero native deps.
 */
export class SimpleTextMetricsMeasurer implements TextMetricsMeasurer {
  private canvasContext: CanvasRenderingContext2D | null | undefined;

  constructor(private readonly registry: FontMetricsRegistry = globalFontMetrics) {}

  measureText(text: string, style?: TextStyle): TextMetricsResult {
    const fontSize = style?.fontSizePt ?? 11;
    const isBold = Boolean(style?.bold);
    const isItalic = Boolean(style?.italic);

    const font = this.registry.resolve(style?.fontFamily, isBold, isItalic);
    if (font) {
      return this.measureWithParsedFont(text, fontSize, isBold, font);
    }

    const canvas = this.getCanvasContext();
    if (canvas && style?.fontFamily) {
      try {
        return this.measureWithCanvas(canvas, text, fontSize, isBold, isItalic, style.fontFamily);
      } catch {
        // Fall through to the heuristic.
      }
    }

    return this.measureWithHeuristic(text, fontSize, isBold);
  }

  /** Layer 1: real glyph advances from a parsed font face. */
  private measureWithParsedFont(text: string, fontSize: number, isBold: boolean, font: FontVariantMatch): TextMetricsResult {
    // No usable cmap (or no space advance to substitute with): measuring
    // here would sum silent zeros, so use the documented heuristic widths
    // openly instead (F-TTFSILENT).
    if (!font.metrics.cmapPresent || font.metrics.advanceOf(' ') === undefined) {
      return this.measureWithHeuristic(text, fontSize, isBold);
    }
    const emScale = fontSize / font.metrics.unitsPerEm;
    const boldFactor = isBold && font.matchedVariant === 'regular' ? 1.06 : 1.0;

    let totalWidth = 0;
    for (const char of text) {
      const advance = font.metrics.advanceOf(char) ?? font.metrics.advanceOf(' ') ?? 0;
      totalWidth += advance * emScale * boldFactor;
    }

    const ascent = font.metrics.ascender * emScale;
    const descent = -font.metrics.descender * emScale;
    return { width: totalWidth, height: ascent + descent, ascent, descent };
  }

  /** Layer 2: the host environment's own text shaping via canvas. */
  private measureWithCanvas(
    canvas: CanvasRenderingContext2D,
    text: string,
    fontSize: number,
    isBold: boolean,
    isItalic: boolean,
    fontFamily: string,
  ): TextMetricsResult {
    const fontString = `${isItalic ? 'italic ' : ''}${isBold ? 'bold ' : ''}${fontSize}pt "${fontFamily.replace(/"/g, '')}"`;
    canvas.font = fontString;
    const metrics = canvas.measureText(text);
    const width = fromPx(metrics.width, 'pt');
    const ascent = Number.isFinite(metrics.fontBoundingBoxAscent) ? fromPx(metrics.fontBoundingBoxAscent, 'pt') : fontSize * 0.82;
    const descent = Number.isFinite(metrics.fontBoundingBoxDescent) ? fromPx(metrics.fontBoundingBoxDescent, 'pt') : fontSize * 0.22;
    return { width, height: ascent + descent, ascent, descent };
  }

  /** Layer 3: the documented per-character approximation. */
  private measureWithHeuristic(text: string, fontSize: number, isBold: boolean): TextMetricsResult {
    const boldFactor = isBold ? 1.06 : 1.0;

    let totalWidth = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text[i]!;
      totalWidth += this.getCharWidth(char, fontSize) * boldFactor;
    }

    const ascent = fontSize * 0.82;
    const descent = fontSize * 0.22;
    const height = ascent + descent;

    return {
      width: totalWidth,
      height,
      ascent,
      descent,
    };
  }

  private getCharWidth(char: string, fontSize: number): number {
    if (char === ' ') return fontSize * 0.3;
    if ('ijl|!:,;.'.includes(char)) return fontSize * 0.28;
    if ('frt'.includes(char)) return fontSize * 0.35;
    if ('mwMW@%&'.includes(char)) return fontSize * 0.85;
    if (char >= 'A' && char <= 'Z') return fontSize * 0.68;
    if (char >= '0' && char <= '9') return fontSize * 0.55;
    return fontSize * 0.52;
  }

  /**
   * Lazily probes for a 2D canvas context. Result is memoized: `undefined`
   * means "not probed yet", `null` means "unavailable" (Node/Bun/workers).
   */
  private getCanvasContext(): CanvasRenderingContext2D | null {
    if (this.canvasContext !== undefined) return this.canvasContext;
    this.canvasContext = null;
    try {
      const doc = (globalThis as { document?: Document }).document;
      const element = doc?.createElement?.('canvas');
      const context = element?.getContext?.('2d');
      if (context) this.canvasContext = context;
    } catch {
      this.canvasContext = null;
    }
    return this.canvasContext;
  }
}

export const defaultTextMetrics = new SimpleTextMetricsMeasurer();

/**
 * Monospace families have a uniform advance, so the per-character heuristics
 * above (tuned for proportional faces) do not apply. They are measured with a
 * fixed ~0.6 em advance instead. This is a documented approximation — a
 * canvas-less environment cannot query real glyph metrics (v1 F6).
 */
const MONOSPACE_FAMILY_PATTERN = /courier|monaco|mono|consolas|menlo|fixed/i;

export function isMonospaceFamily(fontFamily?: string): boolean {
  return Boolean(fontFamily && MONOSPACE_FAMILY_PATTERN.test(fontFamily));
}

/**
 * Standalone text width measurement shared by layout and renderers. Uses the
 * measurement chain (registered font metrics → canvas → heuristic), or a
 * fixed advance for monospace families when no real font is available (v1 F6).
 */
export function measureTextWidth(text: string, fontSize: number, isBold = false, fontFamily?: string): number {
  const boldFactor = isBold ? 1.06 : 1.0;
  if (!globalFontMetrics.has(fontFamily) && isMonospaceFamily(fontFamily)) {
    return text.length * fontSize * 0.6 * boldFactor;
  }
  return defaultTextMetrics.measureText(text, { fontSizePt: fontSize, bold: isBold, fontFamily }).width;
}
