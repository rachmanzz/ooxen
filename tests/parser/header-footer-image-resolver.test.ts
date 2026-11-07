import { describe, expect, it } from 'bun:test';
import type { OpcPackage, OpcPart } from '../../src/opc/package.js';
import type { OpcRelationship } from '../../src/opc/relationships.js';
import { StandardDocumentParser } from '../../src/parser/wml/document-parser.js';

// F-HDRIMG: header/footer image rels must resolve against the header/footer
// part's own .rels file, not document.xml.rels. The fixture below gives the
// SAME rel id ('rId1') two different images: the header one must win inside
// the header, proving there is no cross-part contamination.
const NS = {
  w: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  wp: 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  pic: 'http://schemas.openxmlformats.org/drawingml/2006/picture',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
};

const HDR_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x68, 0x64, 0x72]);
const DOC_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x64, 0x6f, 0x63]);
const IMAGE_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';
const HEADER_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/header';
const DOCUMENT_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

const documentXml = `<w:document xmlns:w="${NS.w}"><w:body><w:p><w:pPr><w:sectPr><w:headerReference xmlns:r="${NS.r}" w:type="default" r:id="rId10"/></w:sectPr></w:pPr><w:r><w:t>Body</w:t></w:r></w:p></w:body></w:document>`;
const headerXml = `<w:hdr xmlns:w="${NS.w}" xmlns:wp="${NS.wp}" xmlns:a="${NS.a}" xmlns:pic="${NS.pic}" xmlns:r="${NS.r}"><w:p><w:r><w:drawing><wp:inline><wp:extent cx="100000" cy="100000"/><wp:docPr id="1" name="H"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="H"/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId1"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p></w:hdr>`;

const enc = new TextEncoder();
const parts: Record<string, OpcPart> = {
  'word/document.xml': { name: 'word/document.xml', contentType: 'application/xml', data: enc.encode(documentXml) },
  'word/header1.xml': { name: 'word/header1.xml', contentType: 'application/xml', data: enc.encode(headerXml) },
  'word/media/hdr.png': { name: 'word/media/hdr.png', contentType: 'image/png', data: HDR_BYTES },
  'word/media/doc.png': { name: 'word/media/doc.png', contentType: 'image/png', data: DOC_BYTES },
};

const rels: Record<string, OpcRelationship[]> = {
  '': [{ id: 'rId1', type: DOCUMENT_TYPE, target: 'word/document.xml' }],
  'word/document.xml': [
    { id: 'rId10', type: HEADER_TYPE, target: 'header1.xml' },
    { id: 'rId1', type: IMAGE_TYPE, target: 'media/doc.png' },
  ],
  'word/header1.xml': [{ id: 'rId1', type: IMAGE_TYPE, target: 'media/hdr.png' }],
};

function stubPackage(): OpcPackage {
  const notSupported = (op: string): never => {
    throw new Error(`stub: ${op} not supported`);
  };
  return {
    getPart: (name: string) => parts[name],
    setPart: () => notSupported('setPart'),
    removePart: () => notSupported('removePart'),
    listParts: () => Object.keys(parts),
    getContentTypes: () => notSupported('getContentTypes'),
    setContentType: () => notSupported('setContentType'),
    getRelationships: (partName?: string) => rels[partName ?? ''] ?? [],
    addRelationship: () => notSupported('addRelationship'),
    serialize: () => Promise.reject(new Error('stub: serialize not supported')),
  };
}

describe('Header/footer image rel scoping (F-HDRIMG)', () => {
  it('resolves header images against the header part rels', () => {
    const doc = new StandardDocumentParser().parsePackage(stubPackage());
    const header = doc.sections[0]?.headers?.default;
    expect(header).toBeDefined();
    const runs = header!.children.flatMap((b) => (b.type === 'paragraph' ? b.children : []));
    const withImage = runs.find((r) => r.image !== undefined);
    expect(withImage?.image?.relationshipId).toBe('rId1');
    // Must be the header-local bytes (HDR), not the document-rel bytes (DOC).
    expect(withImage?.image?.data).toEqual(HDR_BYTES);
  });
});
