import type { TableNode } from '../../types/ast.js';
import type { XmlNode } from '../xml-adapter.js';

/**
 * Parser for w:tbl (tables), w:tr (rows), and w:tc (cells).
 */

export interface TableParser {
  parseTable(node: XmlNode): TableNode;
}
