import { describe, expect, it } from 'bun:test';
import type { DocumentNode, DrawingShapeNode } from '../../src/types/ast.js';
import { StandardHtmlRenderer } from '../../src/renderer/html/html-renderer.js';
import { StandardWmlBuilder } from '../../src/serializer/wml-builder.js';
import { StandardOoxenWriter } from '../../src/serializer/ooxen-writer.js';
import { openPackage } from '../../src/opc/package.js';
import { defaultXmlAdapter } from '../../src/parser/xml-adapter.js';
import { StandardDocumentParser } from '../../src/parser/wml/document-parser.js';

describe('Vector Shape Serialization & HTML-Canvas Round-Trip', () => {
  const shape: DrawingShapeNode = {
    type: 'drawing',
    id: 'shape-42',
    name: 'BezierShape',
    widthPt: 100,
    heightPt: 50,
    commands: [
      { type: 'moveTo', points: [0, 0] },
      { type: 'lineTo', points: [100, 0] },
      { type: 'cubicBezTo', points: [100, 25, 50, 50, 0, 50] },
      { type: 'close', points: [] },
    ],
    fill: '#FF5500',
    stroke: { color: '#002244', widthPt: 1.5 },
  };

  const sampleDoc: DocumentNode = {
    type: 'document',
    sections: [
      {
        type: 'section',
        properties: {
          pageSize: { width: 595.28, height: 841.89 },
          margins: { top: 72, right: 72, bottom: 72, left: 72 },
        },
        children: [
          {
            type: 'paragraph',
            children: [
              {
                type: 'run',
                text: 'Diagram below:',
              },
              {
                type: 'run',
                text: '',
                drawing: shape,
              },
            ],
          },
        ],
      },
    ],
  };

  it('should serialize DrawingML shape into WordprocessingML XML', () => {
    const builder = new StandardWmlBuilder();
    const xml = builder.buildDocumentXml(sampleDoc);

    expect(xml).toContain('<w:drawing>');
    expect(xml).toContain('<wp:inline>');
    expect(xml).toContain('cx="1270000"');
    expect(xml).toContain('cy="635000"');
    expect(xml).toContain('<a:custGeom>');
    expect(xml).toContain('<a:pathLst>');
    expect(xml).toContain('<a:moveTo><a:pt x="0" y="0"/></a:moveTo>');
    expect(xml).toContain('<a:lnTo><a:pt x="100" y="0"/></a:lnTo>');
    expect(xml).toContain('<a:cubicBezTo>');
    expect(xml).toContain('<a:close/>');
    expect(xml).toContain('<a:solidFill><a:srgbClr val="FF5500"/></a:solidFill>');
    expect(xml).toContain('<a:ln w="19050">'); // 1.5 pt * 12700 = 19050
  });

  it('should serialize DrawingML shape to semantic XHTML with SVG', () => {
    const htmlRenderer = new StandardHtmlRenderer();
    const html = htmlRenderer.renderToHtmlString(sampleDoc);

    expect(html).toContain('<svg class="ooxen-shape" width="100pt" height="50pt"');
    expect(html).toContain('viewBox="0 0 100 50"');
    expect(html).toContain('d="M 0 0 L 100 0 C 100 25 50 50 0 50 Z"');
    expect(html).toContain('fill="#FF5500"');
    expect(html).toContain('stroke="#002244"');
    expect(html).toContain('stroke-width="1.5"');
  });

  it('should round-trip export XHTML with SVG shape into DOCX and re-parse to AST', async () => {
    const writer = new StandardOoxenWriter();
    const xhtml = `
      <article class="ooxen-document" xmlns="http://www.w3.org/1999/xhtml">
        <section class="ooxen-section" style="width: 595.28pt; min-height: 841.89pt; padding: 72pt 72pt 72pt 72pt;">
          <p class="ooxen-p">
            <span class="ooxen-r">Vector Shape Test</span>
            <span class="ooxen-r">
              <svg class="ooxen-shape" width="80pt" height="40pt" viewBox="0 0 80 40">
                <path d="M 0 0 L 80 0 L 40 40 Z" fill="#00FF00" stroke="#000000" stroke-width="2"/>
              </svg>
            </span>
          </p>
        </section>
      </article>
    `;

    const docxBytes = await writer.writeFromHtml(xhtml);
    expect(docxBytes.byteLength).toBeGreaterThan(100);

    // Verify OPC package integrity and read document.xml back
    const opc = await openPackage(docxBytes);
    const docPart = opc.getPart('/word/document.xml');
    expect(docPart).toBeDefined();

    const docXmlStr = new TextDecoder().decode(docPart!.data);
    expect(docXmlStr).toContain('<w:drawing>');
    expect(docXmlStr).toContain('cx="1016000"'); // 80pt * 12700
    expect(docXmlStr).toContain('cy="508000"');  // 40pt * 12700
    expect(docXmlStr).toContain('val="00FF00"');

    // Parse back to AST
    const docParser = new StandardDocumentParser();
    const reParsedDoc = docParser.parseDocumentXml(docXmlStr);

    expect(reParsedDoc.sections.length).toBe(1);
    const p = reParsedDoc.sections[0]!.children[0]!;
    expect(p.type).toBe('paragraph');
    if (p.type === 'paragraph') {
      const drawingRun = p.children.find((r) => r.drawing !== undefined);
      expect(drawingRun).toBeDefined();
      expect(drawingRun?.drawing?.widthPt).toBe(80);
      expect(drawingRun?.drawing?.heightPt).toBe(40);
      expect(drawingRun?.drawing?.fill).toBe('#00FF00');
    }
  });
});
