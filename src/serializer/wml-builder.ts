import type { DocumentNode } from '../types/ast.js';

/**
 * Builds standard ISO/IEC 29500-1 WordprocessingML XML strings.
 */

export interface WmlBuilder {
  buildDocumentXml(document: DocumentNode): string;
}
