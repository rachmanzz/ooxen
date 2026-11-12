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

/** Same textbox carried inline: still drained so the text renders in-flow. */
const PARAGRAPH_WITH_INLINE_TEXTBOX = `
<w:p xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
     xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
     xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
     xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"
     xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">
  <w:r>
    <w:t>Before box</w:t>
    <w:drawing>
      <wp:inline>
        <wp:extent cx="100000" cy="100000"/>
        <wp:docPr id="1" name="Banner"/>
        <a:graphic>
          <a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">
            <wps:wsp>
              <wps:txbx>
                <w:txbxContent>
                  <w:p><w:r><w:t>Jurnal Dedikasi Pendidikan</w:t></w:r></w:p>
                </w:txbxContent>
              </wps:txbx>
            </wps:wsp>
          </a:graphicData>
        </a:graphic>
      </wp:inline>
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
  it('keeps floating wps textbox paragraphs on the shape, out of the flow (F-TBXFLOAT)', () => {
    const node = defaultXmlAdapter.parse(PARAGRAPH_WITH_TEXTBOX);
    const paragraph = defaultParagraphParser.parseParagraph(node);
    expect(paragraph.children.map((r) => r.text).join('')).toContain('Before box');

    // Floating textbox content must not surface as flow siblings: it would
    // inject phantom paragraphs that push anchored content (e.g. rules
    // below a kop banner) onto the following text.
    expect(defaultParagraphParser.drainPendingBlocks?.()).toEqual([]);

    const drawing = paragraph.children.find((r) => r.drawing !== undefined)?.drawing;
    expect(drawing?.textbox?.length).toBe(2);
    expect(drawing?.textbox?.map((p) => p.children.map((r) => r.text).join(''))).toEqual([
      'Jurnal Dedikasi Pendidikan',
      'ISSN 2548-8848',
    ]);
  });

  it('still drains inline wps textbox paragraphs as pending blocks', () => {
    const node = defaultXmlAdapter.parse(PARAGRAPH_WITH_INLINE_TEXTBOX);
    defaultParagraphParser.parseParagraph(node);
    const extras = defaultParagraphParser.drainPendingBlocks?.() ?? [];
    expect(extras.length).toBe(1);
    if (extras[0]?.type === 'paragraph') {
      expect(extras[0].children.map((r) => r.text).join('')).toBe('Jurnal Dedikasi Pendidikan');
    }
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

  it('keeps a floating textbox out of the flow even when it holds an inline picture (F-TBXFLOAT)', () => {
    const xml = `
<w:p xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
     xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
     xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
     xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"
     xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">
  <w:r>
    <w:drawing>
      <wp:anchor>
        <wp:docPr id="1" name="Banner"/>
        <a:graphic>
          <a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">
            <wps:wsp>
              <wps:txbx>
                <w:txbxContent>
                  <w:p><w:r><w:t>Banner text</w:t></w:r></w:p>
                  <w:p><w:r><w:drawing><wp:inline><wp:extent cx="914400" cy="914400"/><wp:docPr id="2" name="Logo"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:blipFill><a:blip r:embed="rId9" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>
                </w:txbxContent>
              </wps:txbx>
            </wps:wsp>
          </a:graphicData>
        </a:graphic>
      </wp:anchor>
    </w:drawing>
  </w:r>
</w:p>`;
    const node = defaultXmlAdapter.parse(xml);
    const paragraph = defaultParagraphParser.parseParagraph(node);
    // The nested wp:inline must not demote the outer wp:anchor to inline:
    // nothing drains into the flow, and the text stays on the shape.
    expect(defaultParagraphParser.drainPendingBlocks?.()).toEqual([]);
    const drawing = paragraph.children.find((r) => r.drawing !== undefined)?.drawing;
    expect(drawing?.anchor).toBeDefined();
    expect(drawing?.textbox?.length).toBe(2);
  });
});
