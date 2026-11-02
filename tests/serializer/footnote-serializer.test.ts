import { describe, expect, it } from 'bun:test';
import { openPackage } from '../../src/opc/package.js';
import { KNOWN_CONTENT_TYPES } from '../../src/opc/content-types.js';
import { KNOWN_RELATIONSHIPS } from '../../src/opc/relationships.js';
import { openDocument } from '../../src/parser/wml/document-parser.js';
import { StandardFootnoteBuilder } from '../../src/serializer/footnote-builder.js';
import { exportOoxml } from '../../src/serializer/ooxen-writer.js';
import type { DocumentNode, FootnoteNode } from '../../src/types/ast.js';

describe('ISO/IEC 29500 Footnotes & Endnotes Serializer & Round-Trip', () => {
  const decoder = new TextDecoder();
  const footnoteBuilder = new StandardFootnoteBuilder();

  describe('buildFootnotesXml', () => {
    it('should generate valid footnotes XML with separators and footnotes', () => {
      const footnotes: FootnoteNode[] = [
        {
          type: 'footnote',
          kind: 'footnote',
          id: 1,
          children: [
            {
              type: 'paragraph',
              children: [
                { type: 'run', text: '', isFootnoteRefMark: true },
                { type: 'run', text: ' Footnote citation text.' },
              ],
            },
          ],
        },
      ];

      const xml = footnoteBuilder.buildFootnotesXml(footnotes);

      expect(xml).toContain('xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"');
      expect(xml).toContain('<w:footnote w:type="separator" w:id="-1">');
      expect(xml).toContain('<w:separator/>');
      expect(xml).toContain('<w:footnote w:type="continuationSeparator" w:id="0">');
      expect(xml).toContain('<w:continuationSeparator/>');
      expect(xml).toContain('<w:footnote w:id="1">');
      expect(xml).toContain('<w:footnoteRef/>');
      expect(xml).toContain('Footnote citation text.');
    });
  });

  describe('buildEndnotesXml', () => {
    it('should generate valid endnotes XML with separators and endnotes', () => {
      const endnotes: FootnoteNode[] = [
        {
          type: 'endnote',
          kind: 'endnote',
          id: 1,
          children: [
            {
              type: 'paragraph',
              children: [
                { type: 'run', text: '', isFootnoteRefMark: true },
                { type: 'run', text: ' Endnote citation text.' },
              ],
            },
          ],
        },
      ];

      const xml = footnoteBuilder.buildEndnotesXml(endnotes);

      expect(xml).toContain('<w:endnotes');
      expect(xml).toContain('<w:endnote w:type="separator" w:id="-1">');
      expect(xml).toContain('<w:endnote w:id="1">');
      expect(xml).toContain('Endnote citation text.');
    });
  });

  describe('Full OOXML Package Round-Trip with Footnotes', () => {
    it('should serialize DocumentNode with footnotes and reference into .docx package and re-open it', async () => {
      const doc: DocumentNode = {
        type: 'document',
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
                  { type: 'run', text: 'Sentence with footnote citation' },
                  {
                    type: 'run',
                    text: '[1]',
                    footnoteRef: { id: 1, kind: 'footnote' },
                  },
                ],
              },
            ],
          },
        ],
        footnotes: [
          {
            type: 'footnote',
            kind: 'footnote',
            id: 1,
            children: [
              {
                type: 'paragraph',
                children: [
                  { type: 'run', text: '', isFootnoteRefMark: true },
                  { type: 'run', text: ' Citation explanation' },
                ],
              },
            ],
          },
        ],
      };

      // 1. Export AST with footnotes to .docx buffer
      const docxBytes = await exportOoxml(doc);
      expect(docxBytes.length).toBeGreaterThan(0);

      // 2. Open OPC package and verify parts and relationships
      const pkg = await openPackage(docxBytes);
      const docRels = pkg.getRelationships('word/document.xml');
      expect(docRels.some((r) => r.type === KNOWN_RELATIONSHIPS.FOOTNOTES && r.target === 'footnotes.xml')).toBe(true);

      const fnPart = pkg.getPart('word/footnotes.xml');
      expect(fnPart).toBeDefined();
      expect(fnPart?.contentType).toBe(KNOWN_CONTENT_TYPES.WML_FOOTNOTES);

      const fnXml = decoder.decode(fnPart!.data);
      expect(fnXml).toContain('<w:footnote w:id="1">');
      expect(fnXml).toContain('Citation explanation');

      // 3. Open package back into Document AST
      const recoveredDoc = await openDocument(docxBytes);
      expect(recoveredDoc.footnotes).toBeDefined();
      expect(recoveredDoc.footnotes?.length).toBeGreaterThanOrEqual(1);

      const refRun = recoveredDoc.sections[0]?.children[0];
      expect(refRun?.type).toBe('paragraph');
      if (refRun?.type === 'paragraph') {
        const fnRun = refRun.children.find((r) => r.footnoteRef?.id === 1);
        expect(fnRun).toBeDefined();
        expect(fnRun?.footnoteRef?.kind).toBe('footnote');
      }

      const note = recoveredDoc.footnotes?.find((fn) => fn.id === 1);
      expect(note).toBeDefined();
      expect(note?.children.length).toBe(1);
    });
  });
});
