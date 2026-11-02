import type { ParagraphNode, RunNode } from '../../types/ast.js';
import type { XmlNode } from '../xml-adapter.js';

/**
 * Parser for w:p (paragraphs) and w:r (runs) into AST nodes.
 */

export interface ParagraphParser {
  parseParagraph(node: XmlNode): ParagraphNode;
  parseRun(node: XmlNode): RunNode;
}
