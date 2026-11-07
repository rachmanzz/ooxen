import { describe, expect, it } from 'bun:test';
import { defaultXmlAdapter } from '../../src/parser/xml-adapter.js';
import { defaultParagraphParser } from '../../src/parser/wml/paragraph-parser.js';

/** A paragraph whose run carries a floating wps textbox with two paragraphs. */
const PARAGRAPH_WITH_TEXTBOX = `
<w:p xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
     xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
     xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
     xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"
     xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">
  <w:r>
    <w:t>Before box</w:t>
    <w:drawing>
      <wp:anchor>
        <wp:docPr id="1" name="Banner"/>
        <a:graphic>
          <a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">
            <wps:wsp>
              <wps:txbx>
                <w:txbxContent>
                  <w:p><w:r><w:t>Jurnal Dedikasi Pendidikan</w:t></w:r></w:p>
                  <w:p><w:r><w:t>ISSN 2548-8848</w:t></w:r></w:p>
                </w:txbxContent>
              </wps:txbx>
            </wps:wsp>
          </a:graphicData>
        </a:graphic>
      </wp:anchor>
    </w:drawing>
  </w:r>
</w:p>`;

const PARAGRAPH_WITH_PLAIN_PIC = `
<w:p xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
     xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
     xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
     xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
  <w:r>
    <w:t>Caption</w:t>
    <w:drawing>
      <wp:inline>
        <wp:extent cx="100000" cy="100000"/>
        <wp:docPr id="2" name="pic.png"/>
        <a:graphic>
          <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
            <pic:pic>
              <pic:nvPicPr><pic:cNvPr id="0" name="pic.png"/></pic:nvPicPr>
              <pic:blipFill><a:blip r:embed="rId9" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/></pic:blipFill>
            </pic:pic>
          </a:graphicData>
        </a:graphic>
      </wp:inline>
    </w:drawing>
  </w:r>
</w:p>`;

describe('Shape textbox extraction', () => {
  it('surfaces wps textbox paragraphs as pending blocks', () => {
    const node = defaultXmlAdapter.parse(PARAGRAPH_WITH_TEXTBOX);
    const paragraph = defaultParagraphParser.parseParagraph(node);
    expect(paragraph.children.map((r) => r.text).join('')).toContain('Before box');

    const extras = defaultParagraphParser.drainPendingBlocks?.() ?? [];
    expect(extras.length).toBe(2);
    expect(extras[0]?.type).toBe('paragraph');
    if (extras[0]?.type === 'paragraph' && extras[1]?.type === 'paragraph') {
      expect(extras[0].children.map((r) => r.text).join('')).toBe('Jurnal Dedikasi Pendidikan');
      expect(extras[1].children.map((r) => r.text).join('')).toBe('ISSN 2548-8848');
    }

    // Draining twice yields nothing (no leak into later paragraphs).
    expect(defaultParagraphParser.drainPendingBlocks?.()).toEqual([]);
  });

  it('leaves plain pictures on the run and queues nothing', () => {
    const node = defaultXmlAdapter.parse(PARAGRAPH_WITH_PLAIN_PIC);
    const paragraph = defaultParagraphParser.parseParagraph(node, undefined, undefined, {
      resolveImage: () => undefined,
    });
    const withImage = paragraph.children.find((r) => r.image !== undefined);
    expect(withImage?.image?.relationshipId).toBe('rId9');
    expect(defaultParagraphParser.drainPendingBlocks?.()).toEqual([]);
  });

  it('direct parseRun without resolvers never throws and queues nothing', () => {
    const node = defaultXmlAdapter.parse(PARAGRAPH_WITH_TEXTBOX);
    const runNode = node.children.find((c) => c.nodeName.endsWith(':r') || c.nodeName === 'w:r');
    expect(runNode).toBeDefined();
    const run = defaultParagraphParser.parseRun(runNode!);
    expect(run.text).toContain('Before box');
    expect(defaultParagraphParser.drainPendingBlocks?.()).toEqual([]);
  });
});
