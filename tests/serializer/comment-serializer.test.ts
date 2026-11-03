import { describe, expect, it } from 'bun:test';
import { openPackage } from '../../src/opc/package.js';
import { KNOWN_CONTENT_TYPES } from '../../src/opc/content-types.js';
import { KNOWN_RELATIONSHIPS } from '../../src/opc/relationships.js';
import { openDocument } from '../../src/parser/wml/document-parser.js';
import { defaultHtmlRenderer } from '../../src/renderer/html/html-renderer.js';
import { StandardCommentBuilder } from '../../src/serializer/comment-builder.js';
import { exportOoxmlFromHtml } from '../../src/serializer/ooxen-writer.js';
import { defaultWmlBuilder } from '../../src/serializer/wml-builder.js';
import type { CommentNode, DocumentNode } from '../../src/types/ast.js';

describe('ISO/IEC 29500 Comments & Review Annotations Serializer & Round-Trip', () => {
  const decoder = new TextDecoder();
  const commentBuilder = new StandardCommentBuilder();

  describe('buildCommentsXml', () => {
    it('should generate valid comments XML with all metadata attributes', () => {
      const comments: CommentNode[] = [
        {
          type: 'comment',
          id: '1',
          author: 'Dana Reviewer',
          date: '2026-11-02T12:00:00Z',
          initials: 'DR',
          children: [
            {
              type: 'paragraph',
              children: [{ type: 'run', text: 'Consider updating this section.' }],
            },
          ],
        },
      ];

      const xml = commentBuilder.buildCommentsXml(comments);

      expect(xml).toContain('xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"');
      expect(xml).toContain('<w:comment w:id="1" w:author="Dana Reviewer" w:date="2026-11-02T12:00:00Z" w:initials="DR">');
      expect(xml).toContain('Consider updating this section.');
      expect(xml).toContain('</w:comments>');
    });
  });

  describe('WML Paragraph Builder comment ranges', () => {
    it('should serialize commentRangeStart, commentRangeEnd, and commentReference around annotated runs', () => {
      const paragraph = {
        type: 'paragraph' as const,
        children: [
          { type: 'run' as const, text: 'Normal text ' },
          { type: 'run' as const, text: 'commented target', commentId: '1' },
          { type: 'run' as const, text: ' after text' },
        ],
      };

      const xml = defaultWmlBuilder.buildParagraphXml(paragraph);

      expect(xml).toContain('<w:commentRangeStart w:id="1"/>');
      expect(xml).toContain('commented target');
      expect(xml).toContain('<w:commentRangeEnd w:id="1"/>');
      expect(xml).toContain('<w:commentReference w:id="1"/>');
    });
  });

  describe('HTML Renderer comments support', () => {
    it('should render <mark class="ooxen-comment"> in body and <aside class="ooxen-comments"> at document end', () => {
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
                  { type: 'run', text: 'This has a ' },
                  { type: 'run', text: 'review note', commentId: 'c10' },
                  { type: 'run', text: '.' },
                ],
              },
            ],
          },
        ],
        comments: [
          {
            type: 'comment',
            id: 'c10',
            author: 'Jane Doe',
            date: '2026-11-02T14:30:00Z',
            children: [
              {
                type: 'paragraph',
                children: [{ type: 'run', text: 'Important note on terminology.' }],
              },
            ],
          },
        ],
      };

      const html = defaultHtmlRenderer.renderToHtmlString(doc);

      expect(html).toContain('<mark class="ooxen-comment" data-comment-id="c10">');
      expect(html).toContain('review note');
      expect(html).toContain('<aside class="ooxen-comments">');
      expect(html).toContain('<div class="ooxen-comment-card" id="comment-c10" data-author="Jane Doe" data-date="2026-11-02T14:30:00Z">');
      expect(html).toContain('Important note on terminology.');
    });
  });

  describe('Bidirectional Round-Trip: HTML -> DOCX -> DocumentNode', () => {
    it('should round-trip comments from HTML annotations to DOCX package and re-parse into AST', async () => {
      const htmlInput = `<article class="ooxen-document">
  <section class="ooxen-section">
    <p class="ooxen-p"><span class="ooxen-r">Intro </span><mark class="ooxen-comment" data-comment-id="c1"><span class="ooxen-r">reviewed text</span></mark><span class="ooxen-r"> outro</span></p>
  </section>
  <aside class="ooxen-comments">
    <div class="ooxen-comment-card" id="comment-c1" data-author="Author Name" data-initials="AN" data-date="2026-11-02T12:00:00Z">
      <p class="ooxen-p"><span class="ooxen-r">Please review this wording.</span></p>
    </div>
  </aside>
</article>`;

      const docxBytes = await exportOoxmlFromHtml(htmlInput);

      // Verify OPC package contains word/comments.xml and relationships
      const pkg = await openPackage(docxBytes);
      const comPart = pkg.getPart('word/comments.xml');
      expect(comPart).toBeDefined();
      expect(comPart?.contentType).toBe(KNOWN_CONTENT_TYPES.WML_COMMENTS);

      const docRels = pkg.getRelationships('word/document.xml');
      const comRel = docRels.find((r) => r.type === KNOWN_RELATIONSHIPS.COMMENTS);
      expect(comRel).toBeDefined();
      expect(comRel?.target).toBe('comments.xml');

      const commentsXml = decoder.decode(comPart!.data);
      // ISO/IEC 29500-1 requires w:comment/@w:id to be ST_DecimalNumber, so
      // string AST ids are mapped to their 1-based position in the package.
      expect(commentsXml).toContain('w:id="1"');
      expect(commentsXml).toContain('w:author="Author Name"');
      expect(commentsXml).toContain('Please review this wording.');

      // Re-open and parse using high-level openDocument
      const reloadedDoc = await openDocument(docxBytes);
      expect(reloadedDoc.comments).toBeDefined();
      expect(reloadedDoc.comments?.length).toBe(1);
      expect(reloadedDoc.comments?.[0]?.id).toBe('1');
      expect(reloadedDoc.comments?.[0]?.author).toBe('Author Name');

      const reloadedPara = reloadedDoc.sections[0]?.children[0];
      expect(reloadedPara?.type).toBe('paragraph');
      if (reloadedPara?.type === 'paragraph') {
        const commentedRun = reloadedPara.children.find((r) => r.commentId === '1');
        expect(commentedRun).toBeDefined();
        expect(commentedRun?.text).toBe('reviewed text');
      }
    });
  });
});
