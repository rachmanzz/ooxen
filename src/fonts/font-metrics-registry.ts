/**
 * Registry of parsed font metrics keyed by family name and style variant.
 * Fonts arrive as raw bytes — from embedded DOCX fonts (ODTTF), host
 * applications, or test fixtures — and are parsed once, then cached.
 */

import { parseTtf, type ParsedFontMetrics } from './ttf-parser.js';

export type FontVariant = 'regular' | 'bold' | 'italic' | 'boldItalic';

export interface RegisteredFont {
  metrics: ParsedFontMetrics;
  variant: FontVariant;
}

function normalizeFamily(family: string): string {
  return family
    .replace(/^['"]+|['"]+$/g, '') // strip CSS-style quotes
    .trim()
    .toLowerCase();
}

export interface FontVariantMatch {
  metrics: ParsedFontMetrics;
  /** Whether the requested variant was an exact match or fell back to regular. */
  matchedVariant: FontVariant;
}

export class FontMetricsRegistry {
  /** family (normalized) → variant → parsed metrics */
  private fonts = new Map<string, Map<FontVariant, ParsedFontMetrics>>();

  /**
   * Registers font bytes. When `family` is omitted, the name table inside the
   * font is used. Registering the same family/variant twice replaces the
   * previous entry (last writer wins, useful for font fallback injection).
   */
  register(data: Uint8Array, family?: string, variant: FontVariant = 'regular'): ParsedFontMetrics {
    const metrics = parseTtf(data);
    const key = normalizeFamily(family ?? metrics.familyName ?? 'unknown');
    let variants = this.fonts.get(key);
    if (!variants) {
      variants = new Map();
      this.fonts.set(key, variants);
    }
    variants.set(variant, metrics);
    return metrics;
  }

  /**
   * Resolves metrics for a family, preferring the exact bold/italic variant
   * and falling back to the regular face (the measurer then applies a
   * synthetic-bold factor itself).
   */
  resolve(family: string | undefined, bold = false, italic = false): FontVariantMatch | undefined {
    if (!family) return undefined;
    const variants = this.fonts.get(normalizeFamily(family));
    if (!variants) return undefined;

    const requested: FontVariant = bold && italic ? 'boldItalic' : bold ? 'bold' : italic ? 'italic' : 'regular';
    const exact = variants.get(requested);
    if (exact) return { metrics: exact, matchedVariant: requested };

    const regular = variants.get('regular');
    if (regular) return { metrics: regular, matchedVariant: 'regular' };

    const anyVariant = variants.values().next().value;
    return anyVariant ? { metrics: anyVariant, matchedVariant: 'regular' } : undefined;
  }

  has(family: string | undefined): boolean {
    return Boolean(family && this.fonts.has(normalizeFamily(family)));
  }

  clear(): void {
    this.fonts.clear();
  }
}

/** Process-wide registry used by the default text measurer. */
export const globalFontMetrics = new FontMetricsRegistry();
