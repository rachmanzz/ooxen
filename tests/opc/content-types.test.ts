import { describe, expect, it } from 'bun:test';
import {
  CONTENT_TYPES_NAMESPACE,
  KNOWN_CONTENT_TYPES,
  parseContentTypes,
  serializeContentTypes,
  type ContentTypesManifest,
} from '../../src/opc/content-types.js';

describe('OPC Content Types', () => {
  it('should parse valid [Content_Types].xml', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="${CONTENT_TYPES_NAMESPACE}">
  <Default Extension="rels" ContentType="${KNOWN_CONTENT_TYPES.RELS}"/>
  <Default Extension="xml" ContentType="${KNOWN_CONTENT_TYPES.XML}"/>
  <Override PartName="/word/document.xml" ContentType="${KNOWN_CONTENT_TYPES.WML_DOCUMENT_MAIN}"/>
  <Override PartName="/word/styles.xml" ContentType="${KNOWN_CONTENT_TYPES.WML_STYLES}"/>
</Types>`;

    const manifest = parseContentTypes(xml);
    expect(manifest.defaults.length).toBe(2);
    expect(manifest.overrides.length).toBe(2);

    expect(manifest.defaults[0]?.extension).toBe('rels');
    expect(manifest.defaults[0]?.contentType).toBe(KNOWN_CONTENT_TYPES.RELS);

    expect(manifest.overrides[0]?.partName).toBe('/word/document.xml');
    expect(manifest.overrides[0]?.contentType).toBe(KNOWN_CONTENT_TYPES.WML_DOCUMENT_MAIN);
  });

  it('should serialize and round-trip ContentTypesManifest', () => {
    const original: ContentTypesManifest = {
      defaults: [
        { extension: 'rels', contentType: KNOWN_CONTENT_TYPES.RELS },
        { extension: 'xml', contentType: KNOWN_CONTENT_TYPES.XML },
      ],
      overrides: [
        { partName: '/word/document.xml', contentType: KNOWN_CONTENT_TYPES.WML_DOCUMENT_MAIN },
      ],
    };

    const xml = serializeContentTypes(original);
    expect(xml).toContain('<Types');
    expect(xml).toContain('Default Extension="rels"');
    expect(xml).toContain('Override PartName="/word/document.xml"');

    const parsed = parseContentTypes(xml);
    expect(parsed.defaults).toEqual(original.defaults);
    expect(parsed.overrides).toEqual(original.overrides);
  });
});
