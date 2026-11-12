import { defaultXmlAdapter, type XmlAdapter } from '../parser/xml-adapter.js';

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
  WML_SETTINGS: 'application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml',
  WML_HEADER: 'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml',
  WML_FOOTER: 'application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml',
  WML_FOOTNOTES: 'application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml',
  WML_ENDNOTES: 'application/vnd.openxmlformats-officedocument.wordprocessingml.endnotes+xml',
  WML_COMMENTS: 'application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml',
  CORE_PROPERTIES: 'application/vnd.openxmlformats-package.core-properties+xml',
  EXTENDED_PROPERTIES: 'application/vnd.openxmlformats-officedocument.extended-properties+xml',
} as const;

export const CONTENT_TYPES_NAMESPACE = 'http://schemas.openxmlformats.org/package/2006/content-types';

export function parseContentTypes(xmlString: string, adapter: XmlAdapter = defaultXmlAdapter): ContentTypesManifest {
  const root = adapter.parse(xmlString);
  const defaults: ContentTypeDefault[] = [];
  const overrides: ContentTypeOverride[] = [];

  for (const child of root.children) {
    const name = child.nodeName.toLowerCase();
    if (name === 'default') {
      const ext = child.attributes['Extension'] ?? child.attributes['extension'];
      const ct = child.attributes['ContentType'] ?? child.attributes['contentType'];
      if (ext && ct) {
        defaults.push({ extension: ext.toLowerCase(), contentType: ct });
      }
    } else if (name === 'override') {
      const part = child.attributes['PartName'] ?? child.attributes['partName'];
      const ct = child.attributes['ContentType'] ?? child.attributes['contentType'];
      if (part && ct) {
        const normalizedPart = part.startsWith('/') ? part : '/' + part;
        overrides.push({ partName: normalizedPart, contentType: ct });
      }
    }
  }

  return { defaults, overrides };
}

export function serializeContentTypes(manifest: ContentTypesManifest): string {
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    `<Types xmlns="${CONTENT_TYPES_NAMESPACE}">`,
  ];

  // Attribute values must be XML-escaped: unescaped &, <, ", or > in an
  // extension, part name, or content type produces malformed XML and a
  // corrupt package (v1 F19).
  for (const d of manifest.defaults) {
    lines.push(`  <Default Extension="${escapeXmlAttribute(d.extension)}" ContentType="${escapeXmlAttribute(d.contentType)}"/>`);
  }

  for (const o of manifest.overrides) {
    const part = o.partName.startsWith('/') ? o.partName : '/' + o.partName;
    lines.push(`  <Override PartName="${escapeXmlAttribute(part)}" ContentType="${escapeXmlAttribute(o.contentType)}"/>`);
  }

  lines.push('</Types>');
  return lines.join('\n');
}

function escapeXmlAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function createDefaultContentTypesManifest(): ContentTypesManifest {
  return {
    defaults: [
      { extension: 'rels', contentType: KNOWN_CONTENT_TYPES.RELS },
      { extension: 'xml', contentType: KNOWN_CONTENT_TYPES.XML },
    ],
    overrides: [],
  };
}
