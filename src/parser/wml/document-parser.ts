import type { DocumentNode } from '../../types/ast.js';
import type { XmlNode } from '../xml-adapter.js';

/**
 * Top-level WordprocessingML document parser (w:document & w:body).
 */

export interface DocumentParser {
  parseDocument(rootNode: XmlNode): DocumentNode;
}
