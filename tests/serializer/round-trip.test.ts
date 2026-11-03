import { describe, expect, it } from 'bun:test';
import { openPackage } from '../../src/opc/package.js';
import { StandardDocumentParser } from '../../src/parser/wml/document-parser.js';
import { defaultXmlAdapter } from '../../src/parser/xml-adapter.js';
import { StandardHtmlRenderer } from '../../src/renderer/html/html-renderer.js';
import { exportOoxml, exportOoxmlFromHtml } from '../../src/serializer/ooxen-writer.js';
import type { DocumentNode, ParagraphNode, TableNode } from '../../src/types/ast.js';

describe('Bidirectional Round-Trip Integration', () => {
  const decoder = new TextDecoder();
  const documentParser = new StandardDocumentParser();
  const htmlRenderer = new StandardHtmlRenderer();

  it('should round-trip Document AST -> OOXML (.docx) -> Document AST', async () => {
    const originalDoc: DocumentNode = {
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
              style: { alignment: 'center', spaceBeforePt: 10, spaceAfterPt: 5 },
              children: [
                {
                  type: 'run',
                  text: 'Bidirectional Document Test',
                  style: { bold: true, fontSizePt: 16, color: '#002060' },
                },
              ],
            },
            {
              type: 'table',
              rows: [
                {
                  type: 'table-row',
                  children: [
                    {
                      type: 'table-cell',
                      colSpan: 2,
                      style: { backgroundColor: '#F0F0F0' },
                      children: [
                        {
                          type: 'paragraph',
                          children: [{ type: 'run', text: 'Spanned Cell Content' }],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    // 1. Export AST to OOXML binary buffer
    const docxBytes = await exportOoxml(originalDoc);
    expect(docxBytes).toBeInstanceOf(Uint8Array);
    expect(docxBytes.length).toBeGreaterThan(0);

    // 2. Open generated OOXML package
    const pkg = await openPackage(docxBytes);
    expect(pkg.listParts()).toContain('word/document.xml');
    expect(pkg.listParts()).toContain('word/styles.xml');

    // 3. Read word/document.xml and parse back to AST
    const docPart = pkg.getPart('word/document.xml');
    expect(docPart).toBeDefined();

    const docXmlStr = decoder.decode(docPart!.data);
    const rootNode = defaultXmlAdapter.parse(docXmlStr);
    const recoveredDoc = documentParser.parseDocument(rootNode);

    // 4. Verify structural fidelity
    expect(recoveredDoc.sections.length).toBe(1);
    const section = recoveredDoc.sections[0]!;
    expect(section.properties.pageSize.width).toBe(612);
    expect(section.properties.pageSize.height).toBe(792);

    expect(section.children.length).toBe(2);

    // Verify Paragraph 1
    const p1 = section.children[0] as ParagraphNode;
    expect(p1.type).toBe('paragraph');
    expect(p1.style?.alignment).toBe('center');
    expect(p1.style?.spaceBeforePt).toBe(10);
    expect(p1.style?.spaceAfterPt).toBe(5);

    const r1 = p1.children[0]!;
    expect(r1.text).toBe('Bidirectional Document Test');
    expect(r1.style?.bold).toBe(true);
    expect(r1.style?.fontSizePt).toBe(16);
    expect(r1.style?.color).toBe('#002060');

    // Verify Table
    const table = section.children[1] as TableNode;
    expect(table.type).toBe('table');
    expect(table.rows.length).toBe(1);
    expect(table.rows[0]?.children[0]?.colSpan).toBe(2);
    expect(table.rows[0]?.children[0]?.style?.backgroundColor).toBe('#F0F0F0');
  });

  it('should round-trip XML-HTML -> OOXML (.docx) -> Document AST', async () => {
    const originalDoc: DocumentNode = {
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
              style: { alignment: 'right' },
              children: [
                {
                  type: 'run',
                  text: 'HTML to OOXML Test',
                  style: { italic: true, color: '#FF5500' },
                },
              ],
            },
          ],
        },
      ],
    };

    // 1. Render AST to XML-HTML
    const xhtml = htmlRenderer.renderToHtmlString(originalDoc);

    // 2. Export XML-HTML directly to OOXML (.docx)
    const docxBytes = await exportOoxmlFromHtml(xhtml);
    expect(docxBytes.length).toBeGreaterThan(0);

    // 3. Open package and verify document part
    const pkg = await openPackage(docxBytes);
    const docPart = pkg.getPart('word/document.xml');
    expect(docPart).toBeDefined();

    const docXmlStr = decoder.decode(docPart!.data);
    const rootNode = defaultXmlAdapter.parse(docXmlStr);
    const recoveredDoc = documentParser.parseDocument(rootNode);

    const p = recoveredDoc.sections[0]?.children[0];
    expect(p?.type).toBe('paragraph');
    expect(p?.style?.alignment).toBe('right');

    const r = p?.children[0];
    expect(r?.text).toBe('HTML to OOXML Test');
    expect(r?.style?.italic).toBe(true);
    expect(r?.style?.color).toBe('#FF5500');
  });
});
