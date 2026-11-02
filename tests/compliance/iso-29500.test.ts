import { describe, expect, it } from 'bun:test';
import { CONTENT_TYPES_NAMESPACE, KNOWN_CONTENT_TYPES } from '../../src/opc/content-types.js';
import { openPackage } from '../../src/opc/package.js';
import { KNOWN_RELATIONSHIPS, RELATIONSHIPS_NAMESPACE } from '../../src/opc/relationships.js';
import { NAMESPACES } from '../../src/parser/namespaces.js';
import { defaultXmlAdapter } from '../../src/parser/xml-adapter.js';
import { exportOoxml } from '../../src/serializer/ooxen-writer.js';
import type { DocumentNode } from '../../src/types/ast.js';

describe('Compliance: ISO/IEC 29500 Specification Matrix', () => {
  const decoder = new TextDecoder();

  const testDoc: DocumentNode = {
    type: 'document',
    sections: [
      {
        type: 'section',
        properties: {
          pageSize: { width: 595.3, height: 841.9 }, // A4
          margins: { top: 72, right: 72, bottom: 72, left: 72 },
        },
        children: [
          {
            type: 'paragraph',
            style: { alignment: 'center' },
            children: [
              {
                type: 'run',
                text: ' ISO/IEC 29500 Conformance Document ',
                style: { bold: true, fontSizePt: 14, color: '#1A365D' },
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
                    style: { backgroundColor: '#E2E8F0' },
                    children: [
                      {
                        type: 'paragraph',
                        children: [{ type: 'run', text: 'Merged Table Header' }],
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

  it('Part 2 (OPC): should generate conformant Open Packaging Conventions structure', async () => {
    const docxBytes = await exportOoxml(testDoc);
    const pkg = await openPackage(docxBytes);

    // 1. Mandatory [Content_Types].xml exists and has official schema
    const ct = pkg.getContentTypes();
    expect(ct.defaults.some((d) => d.extension === 'rels' && d.contentType === KNOWN_CONTENT_TYPES.RELS)).toBe(true);
    expect(ct.defaults.some((d) => d.extension === 'xml' && d.contentType === KNOWN_CONTENT_TYPES.XML)).toBe(true);
    expect(
      ct.overrides.some(
        (o) => o.partName === '/word/document.xml' && o.contentType === KNOWN_CONTENT_TYPES.WML_DOCUMENT_MAIN,
      ),
    ).toBe(true);

    // 2. Mandatory package root relationships exist
    const rootRels = pkg.getRelationships();
    expect(rootRels.length).toBeGreaterThan(0);
    expect(rootRels.some((r) => r.type === KNOWN_RELATIONSHIPS.DOCUMENT && r.target === 'word/document.xml')).toBe(
      true,
    );

    // 3. Document part relationships exist
    const docRels = pkg.getRelationships('word/document.xml');
    expect(docRels.some((r) => r.type === KNOWN_RELATIONSHIPS.STYLES && r.target === 'styles.xml')).toBe(true);
  });

  it('Part 1 (WordprocessingML): should generate conformant markup language structures', async () => {
    const docxBytes = await exportOoxml(testDoc);
    const pkg = await openPackage(docxBytes);

    const docPart = pkg.getPart('word/document.xml');
    expect(docPart).toBeDefined();

    const docXml = decoder.decode(docPart!.data);
    const root = defaultXmlAdapter.parse(docXml);

    // 1. Root element is w:document with official namespace
    expect(root.nodeName).toBe('w:document');
    expect(root.attributes['xmlns:w']).toBe(NAMESPACES.WML_STRICT);

    // 2. Body structure
    const body = root.children.find((c) => c.nodeName === 'w:body');
    expect(body).toBeDefined();

    // 3. Paragraph structure (w:p, w:pPr, w:jc, w:r, w:rPr, w:b, w:sz, w:t)
    const p = body?.children.find((c) => c.nodeName === 'w:p');
    expect(p).toBeDefined();
    const pPr = p?.children.find((c) => c.nodeName === 'w:pPr');
    expect(pPr).toBeDefined();
    const jc = pPr?.children.find((c) => c.nodeName === 'w:jc');
    expect(jc?.attributes['w:val']).toBe('center');

    const r = p?.children.find((c) => c.nodeName === 'w:r');
    expect(r).toBeDefined();
    const t = r?.children.find((c) => c.nodeName === 'w:t');
    expect(t?.attributes['xml:space']).toBe('preserve');

    // 4. Table structure (w:tbl, w:tr, w:tc, w:gridSpan)
    const tbl = body?.children.find((c) => c.nodeName === 'w:tbl');
    expect(tbl).toBeDefined();
    const tr = tbl?.children.find((c) => c.nodeName === 'w:tr');
    expect(tr).toBeDefined();
    const tc = tr?.children.find((c) => c.nodeName === 'w:tc');
    expect(tc).toBeDefined();
    const tcPr = tc?.children.find((c) => c.nodeName === 'w:tcPr');
    const gridSpan = tcPr?.children.find((c) => c.nodeName === 'w:gridSpan');
    expect(gridSpan?.attributes['w:val']).toBe('2');

    // 5. Section properties (w:sectPr, w:pgSz, w:pgMar)
    const sectPr = body?.children.find((c) => c.nodeName === 'w:sectPr');
    expect(sectPr).toBeDefined();
    const pgSz = sectPr?.children.find((c) => c.nodeName === 'w:pgSz');
    expect(pgSz).toBeDefined();
    const pgMar = sectPr?.children.find((c) => c.nodeName === 'w:pgMar');
    expect(pgMar).toBeDefined();
  });
});
