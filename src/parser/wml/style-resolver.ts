import type { ParagraphStyle, TextStyle } from '../../types/style.js';
import type { XmlNode } from '../xml-adapter.js';

/**
 * Resolves cascading styles from word/styles.xml.
 */

export interface StyleResolver {
  loadStyles(stylesXmlNode: XmlNode): void;
  resolveParagraphStyle(styleId?: string): ParagraphStyle;
  resolveRunStyle(styleId?: string): TextStyle;
}
