import { describe, expect, it } from 'bun:test';
import { createDocumentSession } from '../../src/model/document-session.js';
import { openDocument } from '../../src/parser/wml/document-parser.js';
import { defaultHtmlRenderer } from '../../src/renderer/html/html-renderer.js';
import { exportOoxmlFromHtml } from '../../src/serializer/ooxen-writer.js';
import { defaultWmlBuilder } from '../../src/serializer/wml-builder.js';
import type { DocumentNode, ParagraphNode } from '../../src/types/ast.js';

describe('ISO/IEC 29500 Revision Tracking Serializer & Session Management', () => {
  describe('WML Builder serialization', () => {
    it('should serialize insert runs inside w:ins and delete runs inside w:del with delText', () => {
      const paragraph: ParagraphNode = {
        type: 'paragraph',
        children: [
          { type: 'run', text: 'Normal text ' },
          {
            type: 'run',
            text: 'added text',
            revision: { type: 'insert', id: '1', author: 'Alice', date: '2026-11-02T10:00:00Z' },
          },
          {
            type: 'run',
            text: 'removed text',
            revision: { type: 'delete', id: '2', author: 'Bob', date: '2026-11-02T11:00:00Z' },
          },
        ],
      };

      const xml = defaultWmlBuilder.buildParagraphXml(paragraph);

      expect(xml).toContain('<w:ins w:id="1" w:author="Alice" w:date="2026-11-02T10:00:00Z">');
      expect(xml).toContain('<w:t>added text</w:t>');
      expect(xml).toContain('</w:ins>');

      expect(xml).toContain('<w:del w:id="2" w:author="Bob" w:date="2026-11-02T11:00:00Z">');
      expect(xml).toContain('<w:delText>removed text</w:delText>');
      expect(xml).toContain('</w:del>');
    });
  });

  describe('HTML Renderer', () => {
    it('should render <ins class="ooxen-ins"> and <del class="ooxen-del"> with metadata attributes', () => {
      const doc: DocumentNode = {
        type: 'document',
        sections: [
          {
            type: 'section',
            properties: { pageSize: { width: 612, height: 792 }, margins: { top: 72, right: 72, bottom: 72, left: 72 } },
            children: [
              {
                type: 'paragraph',
                children: [
                  {
                    type: 'run',
                    text: 'new wording',
                    revision: { type: 'insert', id: 'i1', author: 'Editor A' },
                  },
                  {
                    type: 'run',
                    text: 'old wording',
                    revision: { type: 'delete', id: 'd1', author: 'Editor B' },
                  },
                ],
              },
            ],
          },
        ],
      };

      const html = defaultHtmlRenderer.renderToHtmlString(doc);

      expect(html).toContain('<ins class="ooxen-ins" data-id="i1" data-author="Editor A">');
      expect(html).toContain('new wording');
      expect(html).toContain('</ins>');

      expect(html).toContain('<del class="ooxen-del" data-id="d1" data-author="Editor B">');
      expect(html).toContain('old wording');
      expect(html).toContain('</del>');
    });
  });

  describe('DocumentSession revision operations', () => {
    const docWithRevisions: DocumentNode = {
      type: 'document',
      sections: [
        {
          type: 'section',
          properties: { pageSize: { width: 612, height: 792 }, margins: { top: 72, right: 72, bottom: 72, left: 72 } },
          children: [
            {
              type: 'paragraph',
              children: [
                { type: 'run', text: 'Hello ' },
                {
                  type: 'run',
                  text: 'wonderful ',
                  revision: { type: 'insert', id: 'rev1', author: 'Alice' },
                },
                {
                  type: 'run',
                  text: 'cruel ',
                  revision: { type: 'delete', id: 'rev2', author: 'Bob' },
                },
                { type: 'run', text: 'world!' },
              ],
            },
          ],
        },
      ],
    };

    it('should collect all distinct revisions in document', () => {
      const session = createDocumentSession(docWithRevisions);
      const revs = session.getRevisions();

      expect(revs.length).toBe(2);
      expect(revs.some((r) => r.type === 'insert' && r.author === 'Alice')).toBe(true);
      expect(revs.some((r) => r.type === 'delete' && r.author === 'Bob')).toBe(true);
    });

    it('should accept all revisions: keep insertions and remove deletions', () => {
      const session = createDocumentSession(docWithRevisions);
      const accepted = session.acceptRevisions();

      const p = accepted.document.sections[0]?.children[0] as ParagraphNode;
      const combinedText = p.children.map((r) => r.text).join('');

      expect(combinedText).toBe('Hello wonderful world!');
      expect(p.children.every((r) => r.revision === undefined)).toBe(true);
      expect(accepted.getRevisions().length).toBe(0);
    });

    it('should reject all revisions: remove insertions and restore deletions', () => {
      const session = createDocumentSession(docWithRevisions);
      const rejected = session.rejectRevisions();

      const p = rejected.document.sections[0]?.children[0] as ParagraphNode;
      const combinedText = p.children.map((r) => r.text).join('');

      expect(combinedText).toBe('Hello cruel world!');
      expect(p.children.every((r) => r.revision === undefined)).toBe(true);
      expect(rejected.getRevisions().length).toBe(0);
    });
  });

  describe('Bidirectional Round-Trip: HTML -> DOCX -> DocumentNode', () => {
    it('should round-trip <ins> and <del> tags to OOXML and re-parse into AST', async () => {
      const htmlInput = `<article class="ooxen-document">
  <section class="ooxen-section">
    <p class="ooxen-p">
      <span class="ooxen-r">Status: </span>
      <del class="ooxen-del" data-id="10" data-author="Author A"><span class="ooxen-r">Pending</span></del>
      <ins class="ooxen-ins" data-id="11" data-author="Author B"><span class="ooxen-r">Approved</span></ins>
    </p>
  </section>
</article>`;

      const docxBytes = await exportOoxmlFromHtml(htmlInput);
      const reloadedDoc = await openDocument(docxBytes);

      const p = reloadedDoc.sections[0]?.children[0] as ParagraphNode;
      expect(p).toBeDefined();

      const delRun = p.children.find((r) => r.revision?.type === 'delete');
      expect(delRun).toBeDefined();
      expect(delRun?.text).toBe('Pending');
      expect(delRun?.revision?.author).toBe('Author A');

      const insRun = p.children.find((r) => r.revision?.type === 'insert');
      expect(insRun).toBeDefined();
      expect(insRun?.text).toBe('Approved');
      expect(insRun?.revision?.author).toBe('Author B');
    });
  });
});
