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
 * Universal text metrics measurer using proportional font metrics.
 * Runs anywhere (Browser, Node.js, Web Worker) with zero native dependencies.
 */
export class SimpleTextMetricsMeasurer implements TextMetricsMeasurer {
  measureText(text: string, style?: TextStyle): TextMetricsResult {
    const fontSize = style?.fontSizePt ?? 11;
    const isBold = Boolean(style?.bold);
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
}

export const defaultTextMetrics = new SimpleTextMetricsMeasurer();
