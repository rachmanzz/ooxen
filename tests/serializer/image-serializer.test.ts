import { describe, expect, it } from 'bun:test';
import type { DocumentNode, ImageNode } from '../../src/types/ast.js';
import { StandardHtmlRenderer } from '../../src/renderer/html/html-renderer.js';
import { StandardWmlBuilder } from '../../src/serializer/wml-builder.js';
import { StandardOoxenWriter } from '../../src/serializer/ooxen-writer.js';
import { openPackage } from '../../src/opc/package.js';
import { StandardDocumentParser } from '../../src/parser/wml/document-parser.js';
import { uint8ArrayToBase64 } from '../../src/types/common.js';

describe('Image Serializer & Bidirectional HTML/DOCX Round-Trip', () => {
  const samplePngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);
  const sampleBase64 = uint8ArrayToBase64(samplePngBytes);

  const sampleImageNode: ImageNode = {
    type: 'image',
    id: 'img1',
    name: 'Sample.png',
    altText: 'A sample diagram image',
    widthPt: 200,
    heightPt: 120,
    relationshipId: 'rIdSample',
    data: samplePngBytes,
    mimeType: 'image/png',
  };

  const sampleDoc: DocumentNode = {
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
              { type: 'run', text: 'Here is the diagram:' },
              { type: 'run', text: '', image: sampleImageNode },
            ],
          },
        ],
      },
    ],
  };

  it('should serialize ImageNode into WordprocessingML picture XML', () => {
    const builder = new StandardWmlBuilder();
    const xml = builder.buildDocumentXml(sampleDoc);

    expect(xml).toContain('<w:drawing>');
    expect(xml).toContain('<wp:inline>');
    expect(xml).toContain('cx="2540000"'); // 200 pt * 12700
    expect(xml).toContain('cy="1524000"'); // 120 pt * 12700
    expect(xml).toContain('name="Sample.png"');
    expect(xml).toContain('descr="A sample diagram image"');
    expect(xml).toContain('<pic:pic');
    expect(xml).toContain('r:embed="rIdSample"');
  });

  it('should render ImageNode to XHTML img tag', () => {
    const htmlRenderer = new StandardHtmlRenderer();
    const html = htmlRenderer.renderToHtmlString(sampleDoc);

    expect(html).toContain('<img class="ooxen-image"');
    expect(html).toContain(`src="data:image/png;base64,${sampleBase64}"`);
    expect(html).toContain('alt="A sample diagram image"');
    expect(html).toContain('style="width: 200pt; height: 120pt;"');
  });

  it('should round-trip export XHTML with img into DOCX package and re-parse to AST', async () => {
    const writer = new StandardOoxenWriter();
    const xhtml = `
      <article class="ooxen-document" xmlns="http://www.w3.org/1999/xhtml">
        <section class="ooxen-section" style="width: 612pt; min-height: 792pt; padding: 72pt;">
          <p class="ooxen-p">
            <span class="ooxen-r">Document with Image:</span>
            <span class="ooxen-r">
              <img src="data:image/png;base64,${sampleBase64}" alt="Architecture Diagram" width="180pt" height="90pt" />
            </span>
          </p>
        </section>
      </article>
    `;

    const docxBytes = await writer.writeFromHtml(xhtml);
    expect(docxBytes.byteLength).toBeGreaterThan(100);

    const opc = await openPackage(docxBytes);

    // Verify binary media part exists in package
    const mediaPart = opc.getPart('/word/media/image1.png') ?? opc.getPart('word/media/image1.png');
    expect(mediaPart).toBeDefined();
    expect(mediaPart?.contentType).toBe('image/png');
    expect(mediaPart?.data).toEqual(samplePngBytes);

    // Verify document relationships point to media part
    const rels = opc.getRelationships('word/document.xml');
    const imgRel = rels.find((r) => r.type.endsWith('/image'));
    expect(imgRel).toBeDefined();
    expect(imgRel?.target).toContain('media/image');

    // Verify document.xml references image relationship
    const docPart = opc.getPart('/word/document.xml');
    const docXmlStr = new TextDecoder().decode(docPart!.data);
    expect(docXmlStr).toContain('<pic:pic');
    expect(docXmlStr).toContain(`r:embed="${imgRel!.id}"`);

    // Re-parse with ImageResolver
    const docParser = new StandardDocumentParser();
    const reParsedDoc = docParser.parseDocumentXml(docXmlStr, undefined, undefined, {
      resolveImage: (relId) => {
        const rel = rels.find((r) => r.id === relId);
        if (rel) {
          const partPath = rel.target.startsWith('media/') ? `word/${rel.target}` : rel.target;
          const part = opc.getPart(partPath);
          if (part) {
            return {
              data: part.data,
              mimeType: part.contentType,
            };
          }
        }
        return undefined;
      },
    });

    const p = reParsedDoc.sections[0]!.children[0]!;
    expect(p.type).toBe('paragraph');
    if (p.type === 'paragraph') {
      const imageRun = p.children.find((r) => r.image !== undefined);
      expect(imageRun).toBeDefined();
      expect(imageRun?.image?.widthPt).toBe(180);
      expect(imageRun?.image?.heightPt).toBe(90);
      expect(imageRun?.image?.data).toEqual(samplePngBytes);
      expect(imageRun?.image?.src).toBe(`data:image/png;base64,${sampleBase64}`);
    }
  });
});
