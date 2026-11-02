import { describe, expect, it } from 'bun:test';
import { openPackage } from '../../src/opc/package.js';
import { KNOWN_CONTENT_TYPES } from '../../src/opc/content-types.js';
import { KNOWN_RELATIONSHIPS } from '../../src/opc/relationships.js';
import { openDocument } from '../../src/parser/wml/document-parser.js';
import { exportOoxml } from '../../src/serializer/ooxen-writer.js';
import { StandardMetadataBuilder } from '../../src/serializer/metadata-builder.js';
import type { DocumentMetadata, DocumentNode } from '../../src/types/ast.js';

describe('ISO/IEC 29500 Metadata Serializer & Round-Trip', () => {
  const decoder = new TextDecoder();
  const metadataBuilder = new StandardMetadataBuilder();

  describe('buildCorePropertiesXml', () => {
    it('should generate valid Dublin Core XML with proper namespaces and elements', () => {
      const meta: DocumentMetadata = {
        title: 'Quantum Computing Overview',
        creator: 'Muhammad Abdurrahman',
        subject: 'Physics & Computer Science',
        description: 'An overview of qubits and quantum algorithms.',
        keywords: ['quantum', 'qubits', 'algorithms'],
        lastModifiedBy: 'Alice Editor',
        revision: 2,
        created: '2026-11-02T08:00:00Z',
        modified: '2026-11-02T09:30:00Z',
      };

      const xml = metadataBuilder.buildCorePropertiesXml(meta);

      expect(xml).toContain('xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"');
      expect(xml).toContain('xmlns:dc="http://purl.org/dc/elements/1.1/"');
      expect(xml).toContain('xmlns:dcterms="http://purl.org/dc/terms/"');
      expect(xml).toContain('<dc:title>Quantum Computing Overview</dc:title>');
      expect(xml).toContain('<dc:creator>Muhammad Abdurrahman</dc:creator>');
      expect(xml).toContain('<dc:subject>Physics &amp; Computer Science</dc:subject>');
      expect(xml).toContain('<cp:keywords>quantum, qubits, algorithms</cp:keywords>');
      expect(xml).toContain('<cp:revision>2</cp:revision>');
      expect(xml).toContain('<dcterms:created xsi:type="dcterms:W3CDTF">2026-11-02T08:00:00Z</dcterms:created>');
      expect(xml).toContain('<dcterms:modified xsi:type="dcterms:W3CDTF">2026-11-02T09:30:00Z</dcterms:modified>');
    });
  });

  describe('buildAppPropertiesXml', () => {
    it('should generate valid extended properties XML with stats and application', () => {
      const meta: DocumentMetadata = {
        application: 'Ooxen Next',
        company: 'Rahman Tech Ltd.',
        pages: 3,
        words: 750,
        characters: 4500,
        paragraphs: 20,
        lines: 65,
      };

      const xml = metadataBuilder.buildAppPropertiesXml(meta);

      expect(xml).toContain('xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"');
      expect(xml).toContain('<Application>Ooxen Next</Application>');
      expect(xml).toContain('<Company>Rahman Tech Ltd.</Company>');
      expect(xml).toContain('<Pages>3</Pages>');
      expect(xml).toContain('<Words>750</Words>');
      expect(xml).toContain('<Characters>4500</Characters>');
      expect(xml).toContain('<Paragraphs>20</Paragraphs>');
      expect(xml).toContain('<Lines>65</Lines>');
    });
  });

  describe('Full OOXML Package Round-Trip with Metadata', () => {
    it('should write DocumentNode with metadata into .docx package and re-open it losslessly', async () => {
      const originalDoc: DocumentNode = {
        type: 'document',
        metadata: {
          title: 'Full Package Test',
          creator: 'Rahman',
          subject: 'Metadata Test',
          description: 'Testing end to end serialization of metadata',
          keywords: ['ooxen', 'unit-test'],
          lastModifiedBy: 'Rahman',
          revision: 1,
          created: '2026-11-02T10:00:00Z',
          modified: '2026-11-02T10:05:00Z',
          application: 'Ooxen',
          company: 'RahmanTech',
        },
        sections: [
          {
            type: 'section',
            properties: {
              pageSize: { width: 612, height: 792 },
              margins: { top: 72, right: 72, bottom: 72, left: 72 },
            },
            children: [
              {
                type: 'paragraph',
                children: [
                  {
                    type: 'run',
                    text: 'Document content testing metadata preservation.',
                  },
                ],
              },
            ],
          },
        ],
      };

      // 1. Export AST with metadata to OOXML Uint8Array
      const docxBytes = await exportOoxml(originalDoc);
      expect(docxBytes.length).toBeGreaterThan(0);

      // 2. Open OPC package and check docProps/core.xml & docProps/app.xml
      const pkg = await openPackage(docxBytes);
      const rootRels = pkg.getRelationships();

      expect(rootRels.some((r) => r.type === KNOWN_RELATIONSHIPS.CORE_PROPERTIES && r.target === 'docProps/core.xml')).toBe(true);
      expect(rootRels.some((r) => r.type === KNOWN_RELATIONSHIPS.EXTENDED_PROPERTIES && r.target === 'docProps/app.xml')).toBe(true);

      const corePart = pkg.getPart('docProps/core.xml');
      expect(corePart).toBeDefined();
      expect(corePart?.contentType).toBe(KNOWN_CONTENT_TYPES.CORE_PROPERTIES);

      const coreXml = decoder.decode(corePart!.data);
      expect(coreXml).toContain('<dc:title>Full Package Test</dc:title>');
      expect(coreXml).toContain('<dc:creator>Rahman</dc:creator>');
      expect(coreXml).toContain('<cp:keywords>ooxen, unit-test</cp:keywords>');

      const appPart = pkg.getPart('docProps/app.xml');
      expect(appPart).toBeDefined();
      expect(appPart?.contentType).toBe(KNOWN_CONTENT_TYPES.EXTENDED_PROPERTIES);

      const appXml = decoder.decode(appPart!.data);
      expect(appXml).toContain('<Application>Ooxen</Application>');
      expect(appXml).toContain('<Company>RahmanTech</Company>');

      // 3. High-level openDocument verification
      const recoveredDoc = await openDocument(docxBytes);
      expect(recoveredDoc.metadata).toBeDefined();
      expect(recoveredDoc.metadata?.title).toBe('Full Package Test');
      expect(recoveredDoc.metadata?.creator).toBe('Rahman');
      expect(recoveredDoc.metadata?.subject).toBe('Metadata Test');
      expect(recoveredDoc.metadata?.description).toBe('Testing end to end serialization of metadata');
      expect(recoveredDoc.metadata?.keywords).toEqual(['ooxen', 'unit-test']);
      expect(recoveredDoc.metadata?.application).toBe('Ooxen');
      expect(recoveredDoc.metadata?.company).toBe('RahmanTech');
    });
  });
});
