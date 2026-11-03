import { describe, expect, it } from 'bun:test';
import { KNOWN_CONTENT_TYPES } from '../../src/opc/content-types.js';
import { createPackage, openPackage } from '../../src/opc/package.js';
import { KNOWN_RELATIONSHIPS } from '../../src/opc/relationships.js';

describe('OPC Package Integration', () => {
  it('should create, populate, serialize, and read back an OPC package', async () => {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    const pkg = createPackage();

    // 1. Add root relationship pointing to main document
    pkg.addRelationship(undefined, {
      id: 'rId1',
      type: KNOWN_RELATIONSHIPS.DOCUMENT,
      target: 'word/document.xml',
    });

    // 2. Add document part
    const docXml = '<w:document><w:body><w:p><w:r><w:t>Hello Ooxen</w:t></w:r></w:p></w:body></w:document>';
    pkg.setPart({
      name: 'word/document.xml',
      contentType: KNOWN_CONTENT_TYPES.WML_DOCUMENT_MAIN,
      data: encoder.encode(docXml),
    });

    // 3. Add styles relationship for the document part
    pkg.addRelationship('word/document.xml', {
      id: 'rId2',
      type: KNOWN_RELATIONSHIPS.STYLES,
      target: 'styles.xml',
    });

    // 4. Add styles part
    const stylesXml = '<w:styles><w:style w:styleId="Normal"/></w:styles>';
    pkg.setPart({
      name: 'word/styles.xml',
      contentType: KNOWN_CONTENT_TYPES.WML_STYLES,
      data: encoder.encode(stylesXml),
    });

    // 5. Serialize package to Uint8Array ZIP
    const zipBytes = await pkg.serialize();
    expect(zipBytes).toBeInstanceOf(Uint8Array);
    expect(zipBytes.length).toBeGreaterThan(0);

    // 6. Open package back from raw ZIP bytes
    const openedPkg = await openPackage(zipBytes);

    expect(openedPkg.listParts()).toContain('word/document.xml');
    expect(openedPkg.listParts()).toContain('word/styles.xml');

    const docPart = openedPkg.getPart('word/document.xml');
    expect(docPart).toBeDefined();
    expect(docPart?.contentType).toBe(KNOWN_CONTENT_TYPES.WML_DOCUMENT_MAIN);
    expect(decoder.decode(docPart!.data)).toBe(docXml);

    const rootRels = openedPkg.getRelationships();
    expect(rootRels.length).toBe(1);
    expect(rootRels[0]?.target).toBe('word/document.xml');

    const docRels = openedPkg.getRelationships('word/document.xml');
    expect(docRels.length).toBe(1);
    expect(docRels[0]?.target).toBe('styles.xml');
  });

  it('should throw error when setPart receives invalid part name with traversal (ISO/IEC 29500-2 §9.1.1)', () => {
    const pkg = createPackage();
    const encoder = new TextEncoder();

    expect(() => {
      pkg.setPart({
        name: '../../etc/passwd',
        contentType: 'text/plain',
        data: encoder.encode('malicious'),
      });
    }).toThrow('Invalid OPC part name');

    expect(() => {
      pkg.setPart({
        name: 'word/./current.xml',
        contentType: 'text/plain',
        data: encoder.encode('malicious'),
      });
    }).toThrow('Invalid OPC part name');
  });
});
