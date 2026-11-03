/**
 * Generates a representative DOCX exercising every implemented feature,
 * used as input for the external-audit tools (x2t / python-docx / XSD).
 *
 * Usage: npx bun scripts/audit/make-sample.ts <output.docx>
 */
import { exportOoxml, StandardOoxenWriter } from '../../src/serializer/ooxen-writer.js';
import type { DocumentNode } from '../../src/types/ast.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';

const png1x1 = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

const doc: DocumentNode = {
  type: 'document',
  metadata: {
    title: 'Ooxen Audit Sample',
    creator: 'Ooxen Engine',
    subject: 'ISO/IEC 29500 conformance sample',
    description: 'Feature-exhaustive sample for third-party validation.',
  },
  sections: [
    {
      type: 'section',
      properties: {
        pageSize: { width: 612, height: 792 },
        margins: { top: 72, right: 72, bottom: 72, left: 72 },
      },
      headers: {
        default: {
          type: 'header',
          kind: 'default',
          children: [{ type: 'paragraph', children: [{ type: 'run', text: 'Audit Header' }] }],
        },
      },
      footers: {
        default: {
          type: 'footer',
          kind: 'default',
          children: [{ type: 'paragraph', children: [{ type: 'run', field: 'PAGE', text: '' }] }],
        },
      },
      children: [
        {
          type: 'paragraph',
          style: { alignment: 'center', spaceAfterPt: 12 },
          children: [{ type: 'run', text: 'Ooxen Audit Sample', style: { bold: true, fontSizePt: 18 } }],
        },
        {
          type: 'paragraph',
          style: { numbering: { numId: 1, level: 0 } },
          children: [{ type: 'run', text: 'Numbered item with ', style: {} }, { type: 'run', text: 'bold', style: { bold: true } }, { type: 'run', text: ' text.' }],
        },
        {
          type: 'paragraph',
          children: [
            { type: 'run', text: 'Regular, ', style: {} },
            { type: 'run', text: 'italic', style: { italic: true } },
            { type: 'run', text: ', ', style: {} },
            { type: 'run', text: 'underlined', style: { underline: true } },
            { type: 'run', text: ', and ', style: {} },
            { type: 'run', text: 'highlighted', style: { backgroundColor: 'yellow' } },
            { type: 'run', text: ' runs.', style: {} },
          ],
        },
        {
          type: 'paragraph',
          children: [
            {
              type: 'run',
              text: '',
              image: {
                type: 'image',
                name: 'dot.png',
                widthPt: 24,
                heightPt: 24,
                data: png1x1,
                mimeType: 'image/png',
              },
            },
          ],
        },
        {
          type: 'table',
          columnWidthsPt: [200, 200],
          style: {
            widthPt: 400,
            borderTop: 'single #000000 0.5pt',
            borderBottom: 'single #000000 0.5pt',
            borderLeft: 'single #000000 0.5pt',
            borderRight: 'single #000000 0.5pt',
            borderInsideH: 'single #CCCCCC 0.5pt',
            borderInsideV: 'single #CCCCCC 0.5pt',
          },
          rows: [
            {
              type: 'table-row',
              children: [
                { type: 'table-cell', children: [{ type: 'paragraph', children: [{ type: 'run', text: 'Cell A', style: { bold: true } }] }] },
                { type: 'table-cell', style: { backgroundColor: '#EEEEEE' }, children: [{ type: 'paragraph', children: [{ type: 'run', text: 'Cell B' }] }] },
              ],
            },
            {
              type: 'table-row',
              children: [
                { type: 'table-cell', rowSpan: 0, children: [{ type: 'paragraph', children: [{ type: 'run', text: 'Merged' }] }] },
                { type: 'table-cell', children: [{ type: 'paragraph', children: [{ type: 'run', text: 'Cell D' }] }] },
              ],
            },
          ],
        },
        {
          type: 'paragraph',
          children: [{ type: 'run', text: 'Paragraph with footnote.', footnoteRef: { id: 1, kind: 'footnote' } }],
        },
        {
          type: 'paragraph',
          children: [{ type: 'run', text: 'Commented text.', commentId: 'c1' }],
        },
        {
          type: 'paragraph',
          children: [{ type: 'run', text: 'Link to ', style: {} }, { type: 'run', text: 'Example', style: { color: '#0563C1', underline: true }, hyperlink: { url: 'https://example.com' } }],
        },
      ],
    },
  ],
  footnotes: [
    {
      type: 'footnote',
      id: 1,
      kind: 'footnote',
      children: [{ type: 'paragraph', children: [{ type: 'run', text: 'Footnote body text.' }] }],
    },
  ],
  comments: [
    {
      type: 'comment',
      id: 'c1',
      author: 'Auditor',
      initials: 'AU',
      date: '2026-11-03T00:00:00Z',
      children: [{ type: 'paragraph', children: [{ type: 'run', text: 'Audit comment.' }] }],
    },
  ],
};

const outPath = process.argv[2] ?? 'audit-sample.docx';
await mkdir(dirname(outPath), { recursive: true });
const bytes = await exportOoxml(doc);
await writeFile(outPath, bytes);
console.log(`wrote ${outPath} (${bytes.length} bytes)`);
