/**
 * ISO/IEC 29500-2: [Content_Types].xml handling.
 */

export interface ContentTypeDefault {
  extension: string;
  contentType: string;
}

export interface ContentTypeOverride {
  partName: string;
  contentType: string;
}

export interface ContentTypesManifest {
  defaults: ContentTypeDefault[];
  overrides: ContentTypeOverride[];
}

export const KNOWN_CONTENT_TYPES = {
  RELS: 'application/vnd.openxmlformats-package.relationships+xml',
  XML: 'application/xml',
  WML_DOCUMENT_MAIN: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  WML_STYLES: 'application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml',
  WML_NUMBERING: 'application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml',
  CORE_PROPERTIES: 'application/vnd.openxmlformats-package.core-properties+xml',
} as const;
