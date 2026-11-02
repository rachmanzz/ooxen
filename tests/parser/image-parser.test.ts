import { describe, expect, it } from 'bun:test';
import { parseImageNode, guessMimeType } from '../../src/parser/dml/image-parser.js';
import { base64ToUint8Array, uint8ArrayToBase64 } from '../../src/types/common.js';
import { defaultXmlAdapter } from '../../src/parser/xml-adapter.js';

describe('Image & Binary Media Parser', () => {
  it('should encode and decode base64 without Node.js Buffer', () => {
    const raw = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // PNG header
    const b64 = uint8ArrayToBase64(raw);
    expect(b64).toBe('iVBORw0KGgo=');

    const decoded = base64ToUint8Array(b64);
    expect(decoded).toEqual(raw);

    const withPrefix = `data:image/png;base64,${b64}`;
    const decodedFromUri = base64ToUint8Array(withPrefix);
    expect(decodedFromUri).toEqual(raw);
  });

  it('should guess correct MIME types', () => {
    expect(guessMimeType('photo.jpg')).toBe('image/jpeg');
    expect(guessMimeType('photo.jpeg')).toBe('image/jpeg');
    expect(guessMimeType('logo.png')).toBe('image/png');
    expect(guessMimeType('anim.gif')).toBe('image/gif');
    expect(guessMimeType('banner.webp')).toBe('image/webp');
    expect(guessMimeType('vector.svg')).toBe('image/svg+xml');
  });

  it('should parse DrawingML pic:pic element and resolve binary media', () => {
    const xml = `
      <w:drawing xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
                 xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
                 xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
                 xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"
                 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
        <wp:inline>
          <wp:extent cx="1905000" cy="1270000"/>
          <wp:docPr id="10" name="CompanyLogo.png" descr="Our corporate logo"/>
          <a:graphic>
            <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
              <pic:pic>
                <pic:nvPicPr>
                  <pic:cNvPr id="0" name="CompanyLogo.png"/>
                  <pic:cNvPicPr/>
                </pic:nvPicPr>
                <pic:blipFill>
                  <a:blip r:embed="rIdLogo"/>
                </pic:blipFill>
              </pic:pic>
            </a:graphicData>
          </a:graphic>
        </wp:inline>
      </w:drawing>
    `;

    const dummyPngData = new Uint8Array([1, 2, 3, 4, 5]);

    const root = defaultXmlAdapter.parse(xml);
    const imageNode = parseImageNode(root, {
      resolveImage: (relId) => {
        if (relId === 'rIdLogo') {
          return {
            data: dummyPngData,
            mimeType: 'image/png',
          };
        }
        return undefined;
      },
    });

    expect(imageNode).toBeDefined();
    expect(imageNode?.type).toBe('image');
    expect(imageNode?.id).toBe('10');
    expect(imageNode?.name).toBe('CompanyLogo.png');
    expect(imageNode?.altText).toBe('Our corporate logo');
    expect(imageNode?.relationshipId).toBe('rIdLogo');
    expect(imageNode?.widthPt).toBe(150); // 1905000 / 12700
    expect(imageNode?.heightPt).toBe(100); // 1270000 / 12700
    expect(imageNode?.data).toEqual(dummyPngData);
    expect(imageNode?.mimeType).toBe('image/png');
    expect(imageNode?.src).toBe('data:image/png;base64,AQIDBAU=');
  });

  it('should parse legacy VML imagedata element', () => {
    const xml = `
      <w:pict xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
              xmlns:v="urn:schemas-microsoft-com:vml"
              xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
        <v:shape id="vmlPic1" alt="Vintage Image">
          <v:imagedata r:id="rIdVmlImg" o:title="Vintage"/>
        </v:shape>
      </w:pict>
    `;

    const root = defaultXmlAdapter.parse(xml);
    const imageNode = parseImageNode(root);

    expect(imageNode).toBeDefined();
    expect(imageNode?.id).toBe('vmlPic1');
    expect(imageNode?.relationshipId).toBe('rIdVmlImg');
    expect(imageNode?.altText).toBe('Vintage');
  });
});
