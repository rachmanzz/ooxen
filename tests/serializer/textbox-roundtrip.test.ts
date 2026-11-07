import { describe, expect, it } from 'bun:test';
import { openPackage } from '../../src/opc/package.js';
import { openDocument } from '../../src/parser/wml/document-parser.js';
import { exportOoxml } from '../../src/serializer/ooxen-writer.js';
import type { DocumentNode, DrawingShapeNode, ParagraphNode } from '../../src/types/ast.js';

// F-TXTBOX: textbox text must round-trip inside wps:txbx, not survive only
// as drained in-flow blocks (a layout-changing loss on reparse).
const textboxShape = (text: string): DrawingShapeNode => ({
  type: 'drawing',
  id: '1',
  name: 'Banner 1',
  widthPt: 200,
  heightPt: 50,
  commands: [],
  fill: '#FF0000',
  textbox: [{ type: 'paragraph', children: [{ type: 'run', text }] }],
});

const docWithTextboxShape = (): DocumentNode => ({
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
          children: [{ type: 'run', text: '', drawing: textboxShape('Banner headline') }],
        },
      ],
    },
  ],
});

const documentXml = async (bytes: Uint8Array): Promise<string> => {
  const part = (await openPackage(bytes)).getPart('word/document.xml');
  expect(part).toBeDefined();
  return new TextDecoder().decode(part!.data);
};

const drawingRuns = (doc: DocumentNode): DrawingShapeNode[] => {
  const out: DrawingShapeNode[] = [];
  const visit = (blocks: { type: string }[]): void => {
    for (const b of blocks) {
      if (b.type === 'paragraph') {
        for (const run of (b as ParagraphNode).children) {
          if (run.drawing) out.push(run.drawing);
        }
      }
    }
  };
  for (const s of doc.sections) visit(s.children as { type: string }[]);
  return out;
};

describe('Textbox round-trip (F-TXTBOX)', () => {
  it('writes shape textbox paragraphs inside wps:txbx', async () => {
    const xml = await documentXml(await exportOoxml(docWithTextboxShape()));
    expect(xml).toContain('wps:txbx');
    expect(xml).toContain('w:txbxContent');
    expect(xml).toContain('Banner headline');
  });

  it('reparses the textbox back onto the drawing node', async () => {
    const doc = await openDocument(await exportOoxml(docWithTextboxShape()));
    const drawings = drawingRuns(doc);
    expect(drawings.length).toBeGreaterThan(0);
    const text = drawings
      .flatMap((d) => d.textbox ?? [])
      .map((p) => p.children.map((r) => r.text).join(''))
      .join(' ');
    expect(text).toContain('Banner headline');
  });
});
