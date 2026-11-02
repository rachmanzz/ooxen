import { describe, expect, it } from 'bun:test';
import { createPackage } from '../../src/opc/package.js';
import { KNOWN_RELATIONSHIPS } from '../../src/opc/relationships.js';
import { KNOWN_CONTENT_TYPES } from '../../src/opc/content-types.js';
import {
  parseAppProperties,
  parseCoreProperties,
  parsePackageMetadata,
} from '../../src/parser/metadata/metadata-parser.js';

describe('ISO/IEC 29500 Metadata Parser', () => {
  const encoder = new TextEncoder();

  describe('parseCoreProperties', () => {
    it('should parse all Dublin Core & OpenXML core properties from core.xml', () => {
      const coreXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
  xmlns:dc="http://purl.org/dc/elements/1.1/"
  xmlns:dcterms="http://purl.org/dc/terms/"
  xmlns:dcmitype="http://purl.org/dc/dcmitype/"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>Architecture Specification</dc:title>
  <dc:subject>Engineering Design</dc:subject>
  <dc:creator>Muhammad Abdurrahman</dc:creator>
  <cp:keywords>ooxml, typescript, headless, parser</cp:keywords>
  <dc:description>Comprehensive document specifications and engine design.</dc:description>
  <cp:lastModifiedBy>Reviewer One</cp:lastModifiedBy>
  <cp:revision>3</cp:revision>
  <dcterms:created xsi:type="dcterms:W3CDTF">2026-11-02T10:00:00Z</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">2026-11-02T12:30:00Z</dcterms:modified>
</cp:coreProperties>`;

      const meta = parseCoreProperties(coreXml);

      expect(meta.title).toBe('Architecture Specification');
      expect(meta.subject).toBe('Engineering Design');
      expect(meta.creator).toBe('Muhammad Abdurrahman');
      expect(meta.keywords).toEqual(['ooxml', 'typescript', 'headless', 'parser']);
      expect(meta.description).toBe('Comprehensive document specifications and engine design.');
      expect(meta.lastModifiedBy).toBe('Reviewer One');
      expect(meta.revision).toBe(3);
      expect(meta.created).toBe('2026-11-02T10:00:00Z');
      expect(meta.modified).toBe('2026-11-02T12:30:00Z');
    });

    it('should handle semicolons in keywords and un-prefixed tags gracefully', () => {
      const xml = `<coreProperties>
  <title>Minimal Title</title>
  <keywords>first; second; third</keywords>
</coreProperties>`;

      const meta = parseCoreProperties(xml);
      expect(meta.title).toBe('Minimal Title');
      expect(meta.keywords).toEqual(['first', 'second', 'third']);
    });
  });

  describe('parseAppProperties', () => {
    it('should parse extended application properties from app.xml', () => {
      const appXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"
  xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Template>Normal.dotm</Template>
  <TotalTime>15</TotalTime>
  <Pages>4</Pages>
  <Words>1250</Words>
  <Characters>8400</Characters>
  <Application>Ooxen Universal Engine</Application>
  <Lines>120</Lines>
  <Paragraphs>35</Paragraphs>
  <Company>Rahman Tech</Company>
  <AppVersion>1.0000</AppVersion>
</Properties>`;

      const meta = parseAppProperties(appXml);

      expect(meta.application).toBe('Ooxen Universal Engine');
      expect(meta.company).toBe('Rahman Tech');
      expect(meta.pages).toBe(4);
      expect(meta.words).toBe(1250);
      expect(meta.characters).toBe(8400);
      expect(meta.lines).toBe(120);
      expect(meta.paragraphs).toBe(35);
    });
  });

  describe('parsePackageMetadata', () => {
    it('should extract and combine metadata from package parts docProps/core.xml and docProps/app.xml', () => {
      const pkg = createPackage();

      const coreXml = `<?xml version="1.0" encoding="UTF-8"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
  xmlns:dc="http://purl.org/dc/elements/1.1/">
  <dc:title>Package Integration Test</dc:title>
  <dc:creator>Test Suite</dc:creator>
</cp:coreProperties>`;

      const appXml = `<?xml version="1.0" encoding="UTF-8"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">
  <Application>Ooxen Test Runner</Application>
  <Pages>2</Pages>
</Properties>`;

      pkg.addRelationship(undefined, {
        id: 'rIdCore',
        type: KNOWN_RELATIONSHIPS.CORE_PROPERTIES,
        target: 'docProps/core.xml',
      });
      pkg.setPart({
        name: 'docProps/core.xml',
        contentType: KNOWN_CONTENT_TYPES.CORE_PROPERTIES,
        data: encoder.encode(coreXml),
      });

      pkg.addRelationship(undefined, {
        id: 'rIdApp',
        type: KNOWN_RELATIONSHIPS.EXTENDED_PROPERTIES,
        target: 'docProps/app.xml',
      });
      pkg.setPart({
        name: 'docProps/app.xml',
        contentType: KNOWN_CONTENT_TYPES.EXTENDED_PROPERTIES,
        data: encoder.encode(appXml),
      });

      const meta = parsePackageMetadata(pkg);
      expect(meta).toBeDefined();
      expect(meta?.title).toBe('Package Integration Test');
      expect(meta?.creator).toBe('Test Suite');
      expect(meta?.application).toBe('Ooxen Test Runner');
      expect(meta?.pages).toBe(2);
    });

    it('should return undefined if neither core.xml nor app.xml exists in package', () => {
      const pkg = createPackage();
      const meta = parsePackageMetadata(pkg);
      expect(meta).toBeUndefined();
    });
  });
});
