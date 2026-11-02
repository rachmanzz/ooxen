import type { DocumentNode } from '../types/ast.js';

/**
 * Public export API converting Document AST to an OOXML (.docx) Uint8Array buffer.
 */

export interface OoxenWriter {
  write(document: DocumentNode): Promise<Uint8Array>;
}
