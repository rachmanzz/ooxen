import { defaultXmlAdapter, type XmlAdapter } from '../parser/xml-adapter.js';

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

export const RELATIONSHIPS_NAMESPACE = 'http://schemas.openxmlformats.org/package/2006/relationships';

export const KNOWN_RELATIONSHIPS = {
  DOCUMENT: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument',
  STYLES: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles',
  NUMBERING: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering',
  IMAGE: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image',
  HEADER: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/header',
  FOOTER: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer',
  HYPERLINK: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink',
  CORE_PROPERTIES: 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties',
  EXTENDED_PROPERTIES: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties',
} as const;

export function getRelationshipsPath(partPath?: string): string {
  if (!partPath || partPath === '' || partPath === '/') {
    return '_rels/.rels';
  }
  const normalized = partPath.replace(/^\/+/, '');
  const lastSlash = normalized.lastIndexOf('/');
  if (lastSlash === -1) {
    return `_rels/${normalized}.rels`;
  }
  const dir = normalized.slice(0, lastSlash);
  const file = normalized.slice(lastSlash + 1);
  return `${dir}/_rels/${file}.rels`;
}

export function parseRelationships(xmlString: string, adapter: XmlAdapter = defaultXmlAdapter): OpcRelationship[] {
  const root = adapter.parse(xmlString);
  const rels: OpcRelationship[] = [];

  for (const child of root.children) {
    if (child.nodeName.toLowerCase() === 'relationship') {
      const id = child.attributes['Id'] ?? child.attributes['id'];
      const type = child.attributes['Type'] ?? child.attributes['type'];
      const target = child.attributes['Target'] ?? child.attributes['target'];
      const targetMode = (child.attributes['TargetMode'] ?? child.attributes['targetmode']) as RelationshipTargetMode | undefined;

      if (id && type && target) {
        rels.push({
          id,
          type,
          target,
          ...(targetMode ? { targetMode } : {}),
        });
      }
    }
  }

  return rels;
}

export function serializeRelationships(rels: OpcRelationship[]): string {
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    `<Relationships xmlns="${RELATIONSHIPS_NAMESPACE}">`,
  ];

  for (const r of rels) {
    const targetModeAttr = r.targetMode ? ` TargetMode="${r.targetMode}"` : '';
    lines.push(`  <Relationship Id="${r.id}" Type="${r.type}" Target="${r.target}"${targetModeAttr}/>`);
  }

  lines.push('</Relationships>');
  return lines.join('\n');
}
