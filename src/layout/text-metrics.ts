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
  measureText(text: string, style: TextStyle): TextMetricsResult;
}
