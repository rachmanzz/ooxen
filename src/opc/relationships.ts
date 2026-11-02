/**
 * ISO/IEC 29500-2: OPC Relationships (.rels) handling.
 */

export type RelationshipTargetMode = 'Internal' | 'External';

export interface OpcRelationship {
  id: string;
  type: string;
  target: string;
  targetMode?: RelationshipTargetMode;
}

export const KNOWN_RELATIONSHIPS = {
  DOCUMENT: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument',
  STYLES: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles',
  NUMBERING: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering',
  IMAGE: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image',
} as const;
