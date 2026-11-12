import { describe, expect, it } from 'bun:test';
import { openPackage } from '../../src/opc/package.js';
import { openDocument } from '../../src/parser/wml/document-parser.js';
import { StandardOoxenWriter } from '../../src/serializer/ooxen-writer.js';
import { defaultPackageBuilder } from '../../src/serializer/package-builder.js';
import type { DocumentNode, HeaderFooterNode, ImageNode } from '../../src/types/ast.js';

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);

const dataImage = (overrides?: Partial<ImageNode>): ImageNode => ({
  type: 'image',
  name: 'Test.png',
  widthPt: 100,
  heightPt: 50,
  data: PNG,
  mimeType: 'image/png',
  ...overrides,
});

const paraWithImage = (image: ImageNode) => ({
  type: 'paragraph' as const,
  children: [{ type: 'run' as const, text: '', image }],
});

const headerWithImage = (image: ImageNode): HeaderFooterNode => ({
  type: 'header',
  kind: 'default',
  children: [paraWithImage(image)],
});

const docWith = (sections: DocumentNode['sections'], extra?: Partial<DocumentNode>): DocumentNode => ({
  type: 'document',
  sections,
  ...extra,
});

const baseSection = (children: DocumentNode['sections'][0]['children'] = []) => ({
  type: 'section' as const,
  properties: {
    pageSize: { width: 612, height: 792 },
    margins: { top: 72, right: 72, bottom: 72, left: 72 },
  },
  children,
});

const partText = async (bytes: Uint8Array, name: string): Promise<string> => {
  const part = (await openPackage(bytes)).getPart(name);
  expect(part).toBeDefined();
  return new TextDecoder().decode(part!.data);
};

// P1 write-integrity batch (v4 roast): images, hyperlinks, and media in
// header/footer/footnote/comment parts must resolve inside their own part,
// anchors must survive the round trip, and dataless images must not emit
// dangling references.
describe('Write integrity for notes and part-local media (F-WIMG-HDR, F-WNOTE-SCAN, F-WLINK-NOTE, F-WIMG-SRC, F-WFLOAT-WRITE, F-WNOTE-MEDIA)', () => {
  it('emits header image rels on the header part, not document.xml (F-WIMG-HDR)', async () => {
    const doc = docWith([{
      ...baseSection([{ type: 'paragraph', children: [{ type: 'run', text: 'Body' }] }]),
      headers: { default: headerWithImage(dataImage()) },
    }]);
    const bytes = await new StandardOoxenWriter().write(doc);
    const pkg = await openPackage(bytes);

    const hdrRels = pkg.getRelationships('word/header1.xml');
    const imgRel = hdrRels.find((r) => r.type.endsWith('/image'));
    expect(imgRel).toBeDefined();

    const hdrXml = await partText(bytes, 'word/header1.xml');
    expect(hdrXml).toContain(`r:embed="${imgRel!.id}"`);

    const docRels = pkg.getRelationships('word/document.xml');
    expect(docRels.some((r) => r.id === imgRel!.id && r.type.endsWith('/image'))).toBe(false);
  });

  it('collects footnote/endnote/comment images and hyperlinks into their own parts (F-WNOTE-SCAN, F-WLINK-NOTE)', async () => {
    const linkRun = { type: 'run' as const, text: 'link', hyperlink: { url: 'https://example.com/note' } };
    const doc = docWith(
      [baseSection([{ type: 'paragraph', children: [{ type: 'run', text: 'Body' }] }])],
      {
        footnotes: [{
          type: 'footnote' as const, kind: 'footnote' as const, id: 1,
          children: [{ type: 'paragraph' as const, children: [{ type: 'run' as const, text: '', image: dataImage() }, linkRun] }],
        }],
        comments: [{
          type: 'comment' as const, id: 'c1', author: 'QA',
          children: [{ type: 'paragraph' as const, children: [linkRun] }],
        }],
      },
    );
    const bytes = await new StandardOoxenWriter().write(doc);
    const pkg = await openPackage(bytes);

    const fnRels = pkg.getRelationships('word/footnotes.xml');
    expect(fnRels.some((r) => r.type.endsWith('/image'))).toBe(true);
    expect(fnRels.some((r) => r.type.endsWith('/hyperlink'))).toBe(true);
    const fnXml = await partText(bytes, 'word/footnotes.xml');
    expect(fnXml).toContain('r:id="rIdLink1"');
    expect(fnXml).not.toContain('r:id="rIdLink"');

    const cXml = await partText(bytes, 'word/comments.xml');
    expect(cXml).toContain('r:id="rIdLink1"');
    expect(cXml).not.toContain('r:id="rIdLink"');
    const cRels = pkg.getRelationships('word/comments.xml');
    expect(cRels.some((r) => r.type.endsWith('/hyperlink'))).toBe(true);
  });

  it('links remote images externally and never emits dangling embeds (F-WIMG-SRC)', async () => {
    const doc = docWith([baseSection([
      paraWithImage(dataImage({ data: undefined, src: 'https://example.com/pic.png' })),
      paraWithImage(dataImage({ data: undefined, src: '' })),
    ])]);
    const bytes = await new StandardOoxenWriter().write(doc);
    const pkg = await openPackage(bytes);

    const xml = await partText(bytes, 'word/document.xml');
    expect(xml).toContain('r:link=');
    expect(xml).not.toContain('rIdImage');
    const docRels = pkg.getRelationships('word/document.xml');
    expect(docRels.some((r) => r.type.endsWith('/image') && r.targetMode === 'External')).toBe(true);
    expect(docRels.some((r) => r.type.endsWith('/image') && !r.targetMode)).toBe(false);
  });

  it('round-trips floating anchors instead of flattening to inline (F-WFLOAT-WRITE)', async () => {
    const offsetImage = dataImage({
      anchor: {
        horizontalFrom: 'column', horizontalOffsetPt: 36,
        verticalFrom: 'paragraph', verticalOffsetPt: 12, behindDoc: true,
      },
    });
    const alignImage = dataImage({
      anchor: {
        horizontalFrom: 'column', horizontalOffsetPt: 0, horizontalAlign: 'center',
        verticalFrom: 'page', verticalOffsetPt: 0, verticalAlign: 'bottom',
      },
    });
    const doc = docWith([baseSection([paraWithImage(offsetImage), paraWithImage(alignImage)])]);
    const bytes = await new StandardOoxenWriter().write(doc);
    const xml = await partText(bytes, 'word/document.xml');
    expect(xml).toContain('<wp:anchor');
    expect(xml).not.toContain('<wp:inline>');
    expect(xml).toContain('<wp:align>center</wp:align>');
    // CT_Anchor requires a wrap element between extent and docPr.
    expect(xml).toMatch(/<wp:extent[^>]*\/>\s*<wp:wrapNone\/>\s*<wp:docPr/);

    const reparsed = await openDocument(bytes);
    const paras = reparsed.sections[0]!.children.filter((b) => b.type === 'paragraph');
    expect(paras.length).toBeGreaterThan(1);
    const first = paras[0]!;
    const offset = first.type === 'paragraph' ? first.children[0]?.image : undefined;
    expect(offset?.anchor?.horizontalFrom).toBe('column');
    expect(offset?.anchor?.horizontalOffsetPt).toBeCloseTo(36, 5);
    expect(offset?.anchor?.behindDoc).toBe(true);
    // Align replaces the offset by F-ANCHOR design: no posOffset is emitted.
    const second = paras[1]!;
    const aligned = second.type === 'paragraph' ? second.children[0]?.image : undefined;
    expect(aligned?.anchor?.horizontalAlign).toBe('center');
    expect(aligned?.anchor?.verticalAlign).toBe('bottom');
  });

  it('preserves block media inside footnotes and comments (F-WNOTE-MEDIA)', async () => {
    const drawing = {
      type: 'drawing' as const, name: 'Shape 1', widthPt: 60, heightPt: 30, commands: [],
    };
    const doc = docWith(
      [baseSection()],
      {
        footnotes: [{
          type: 'footnote' as const, kind: 'footnote' as const, id: 1,
          children: [
            { type: 'image' as const, name: 'Fn.png', widthPt: 40, heightPt: 20, data: PNG, mimeType: 'image/png' },
            { type: 'paragraph' as const, children: [{ type: 'run' as const, text: '', drawing }] },
          ],
        }],
        comments: [{
          type: 'comment' as const, id: 'c1',
          children: [{
            type: 'table' as const,
            rows: [{
              type: 'table-row' as const,
              children: [{
                type: 'table-cell' as const,
                children: [{ type: 'paragraph' as const, children: [{ type: 'run' as const, text: 'Cell' }] }],
              }],
            }],
          }],
        }],
      },
    );
    const bytes = await new StandardOoxenWriter().write(doc);
    const reparsed = await openDocument(bytes);
    const fn = reparsed.footnotes?.find((f) => f.id === 1);
    expect(fn).toBeDefined();
    // Block images normalize to paragraph-wrapped image runs; the media
    // must survive with data, not vanish as before.
    const hasImage = fn!.children.some((b) =>
      b.type === 'image' ||
      (b.type === 'paragraph' && b.children.some((r) => r.image?.data !== undefined)),
    );
    expect(hasImage).toBe(true);
    expect(fn!.children.some((b) => b.type === 'paragraph' &&
      b.children.some((r) => r.drawing !== undefined))).toBe(true);
    const fnRels = (await openPackage(bytes)).getRelationships('word/footnotes.xml');
    expect(fnRels.some((r) => r.type.endsWith('/image'))).toBe(true);
    // Tables in comments used to be replaced with an empty <w:p/>.
    // (Comment ids renumber on write, so take the single comment.)
    const comment = reparsed.comments?.[0];
    expect(comment?.children.some((b) => b.type === 'table')).toBe(true);
  });

  it('writes evenAndOddHeaders to settings.xml, never into sectPr (F-HDREVEN)', async () => {
    const header = (kind: 'default' | 'even', text: string): HeaderFooterNode => ({
      type: 'header',
      kind,
      children: [{ type: 'paragraph', children: [{ type: 'run', text }] }],
    });
    const section = baseSection([{ type: 'paragraph', children: [{ type: 'run', text: 'Body' }] }]);
    const doc = docWith([{
      ...section,
      properties: { ...section.properties, evenAndOddHeaders: true },
      headers: { default: header('default', 'Odd'), even: header('even', 'Even') },
    }]);
    const bytes = await new StandardOoxenWriter().write(doc);
    const documentXml = await partText(bytes, 'word/document.xml');
    expect(documentXml).not.toContain('evenAndOddHeaders');
    const settingsXml = await partText(bytes, 'word/settings.xml');
    expect(settingsXml).toContain('<w:evenAndOddHeaders/>');
    const docRels = (await openPackage(bytes)).getRelationships('word/document.xml');
    expect(docRels.some((r) => r.type.endsWith('/settings') && r.target === 'settings.xml')).toBe(true);

    const reparsed = await openDocument(bytes);
    expect(reparsed.sections[0]!.properties.evenAndOddHeaders).toBe(true);
    expect(reparsed.sections[0]!.headers?.even).toBeDefined();
  });

  it('leaves evenAndOddHeaders unset when no section asks for it (F-HDREVEN)', async () => {
    const doc = docWith([baseSection([{ type: 'paragraph', children: [{ type: 'run', text: 'Body' }] }])]);
    const bytes = await new StandardOoxenWriter().write(doc);
    expect((await openPackage(bytes)).getPart('word/settings.xml')).toBeUndefined();
    const reparsed = await openDocument(bytes);
    // A parsed package records the switch explicitly so the layout can
    // tell "unused even part" from "hand-built section".
    expect(reparsed.sections[0]!.properties.evenAndOddHeaders).toBe(false);
  });

  it('writes settings.xml for a hand-built section whose even header has no flag (F-HDREVEN)', async () => {
    const header = (kind: 'default' | 'even', text: string): HeaderFooterNode => ({
      type: 'header',
      kind,
      children: [{ type: 'paragraph', children: [{ type: 'run', text }] }],
    });
    const doc = docWith([{
      ...baseSection([{ type: 'paragraph', children: [{ type: 'run', text: 'Body' }] }]),
      headers: { default: header('default', 'Odd'), even: header('even', 'Even') },
    }]);
    const bytes = await new StandardOoxenWriter().write(doc);
    expect(await partText(bytes, 'word/settings.xml')).toContain('<w:evenAndOddHeaders/>');
    const reparsed = await openDocument(bytes);
    expect(reparsed.sections[0]!.properties.evenAndOddHeaders).toBe(true);
  });

  it('registers a shared image once per owner part (F-WIMG-HDR)', async () => {
    const logo = dataImage({ name: 'logo.png' });
    const section = baseSection([paraWithImage(logo), paraWithImage(logo), paraWithImage(logo)]);
    const doc = docWith([{ ...section, headers: { default: headerWithImage(logo) } }]);
    let mediaCount = -1;
    const spyBuilder = {
      assemblePackage: (...args: Parameters<typeof defaultPackageBuilder.assemblePackage>) => {
        mediaCount = (args[3] ?? []).length;
        return defaultPackageBuilder.assemblePackage(...args);
      },
    };
    const bytes = await new StandardOoxenWriter(undefined, spyBuilder).write(doc);
    // One entry for word/document.xml and one for the header part.
    expect(mediaCount).toBe(2);
    const pkg = await openPackage(bytes);
    const docImageRels = pkg.getRelationships('word/document.xml').filter((r) => r.type.endsWith('/image'));
    expect(docImageRels.length).toBe(1);
  });
});
