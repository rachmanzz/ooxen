import type { ParagraphStyle, TextStyle } from '../../types/style.js';

/**
 * Maps OOXML styling properties to CSS inline declarations.
 */

export interface StyleMapper {
  textStyleToCss(style?: TextStyle): Record<string, string>;
  paragraphStyleToCss(style?: ParagraphStyle): Record<string, string>;
}
