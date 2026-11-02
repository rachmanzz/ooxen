import type { ContentTypesManifest } from './content-types.js';
import type { OpcRelationship } from './relationships.js';

/**
 * Open Packaging Conventions (OPC) Container abstraction.
 */

export interface OpcPart {
  name: string; // e.g. "word/document.xml"
  contentType: string;
  data: Uint8Array;
}

export interface OpcPackage {
  getPart(name: string): OpcPart | undefined;
  setPart(part: OpcPart): void;
  listParts(): string[];
  getContentTypes(): ContentTypesManifest;
  getRelationships(partName?: string): OpcRelationship[];
  serialize(): Promise<Uint8Array>;
}
