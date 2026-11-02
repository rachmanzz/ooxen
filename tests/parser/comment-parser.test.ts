import { describe, expect, it } from 'bun:test';
import { parseCommentsXml } from '../../src/parser/wml/comment-parser.js';
import { StandardParagraphParser } from '../../src/parser/wml/paragraph-parser.js';
import { defaultXmlAdapter } from '../../src/parser/xml-adapter.js';
import { defaultLineBreaker } from '../../src/layout/line-breaker.js';

describe('ISO/IEC 29500 Comments & Review Annotations Parser', () => {
  const paragraphParser = new StandardParagraphParser();

  describe('parseCommentsXml', () => {
    it('should parse word/comments.xml into CommentNode array', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:comment w:id="1" w:author="Alice reviewer" w:date="2026-11-02T10:00:00Z" w:initials="AR">
    <w:p>
      <w:r>
        <w:t>Please clarify this statement.</w:t>
      </w:r>
    </w:p>
  </w:comment>
  <w:comment w:id="2" w:author="Bob approver" w:date="2026-11-02T11:00:00Z" w:initials="BA">
    <w:p>
      <w:r>
        <w:t>Looks good to me.</w:t>
      </w:r>
    </w:p>
  </w:comment>
</w:comments>`;

      const comments = parseCommentsXml(xml);
      expect(comments.length).toBe(2);

      const c1 = comments[0]!;
      expect(c1.type).toBe('comment');
      expect(c1.id).toBe('1');
      expect(c1.author).toBe('Alice reviewer');
      expect(c1.date).toBe('2026-11-02T10:00:00Z');
      expect(c1.initials).toBe('AR');
      expect(c1.children.length).toBe(1);

      const p1 = c1.children[0];
      expect(p1?.type).toBe('paragraph');
      if (p1?.type === 'paragraph') {
        expect(p1.children[0]?.text).toBe('Please clarify this statement.');
      }

      const c2 = comments[1]!;
      expect(c2.id).toBe('2');
      expect(c2.author).toBe('Bob approver');
      expect(c2.initials).toBe('BA');
    });
  });

  describe('ParagraphParser comment ranges & references', () => {
    it('should assign commentId to runs within commentRangeStart and commentRangeEnd', () => {
      const pXml = `<w:p xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:r><w:t>Before comment. </w:t></w:r>
  <w:commentRangeStart w:id="42"/>
  <w:r><w:t>Commented text here.</w:t></w:r>
  <w:commentRangeEnd w:id="42"/>
  <w:r>
    <w:commentReference w:id="42"/>
  </w:r>
  <w:r><w:t> After comment.</w:t></w:r>
</w:p>`;

      const pNode = defaultXmlAdapter.parse(pXml);
      const paragraph = paragraphParser.parseParagraph(pNode);

      expect(paragraph.children.length).toBe(3);
      expect(paragraph.children[0]?.text).toBe('Before comment. ');
      expect(paragraph.children[0]?.commentId).toBeUndefined();

      expect(paragraph.children[1]?.text).toBe('Commented text here.');
      expect(paragraph.children[1]?.commentId).toBe('42');

      expect(paragraph.children[2]?.text).toBe(' After comment.');
      expect(paragraph.children[2]?.commentId).toBeUndefined();
    });

    it('should preserve standalone commentReference anchor when no prior range exists', () => {
      const pXml = `<w:p xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:r><w:t>Prefix </w:t></w:r>
  <w:r><w:commentReference w:id="99"/></w:r>
  <w:r><w:t>Suffix</w:t></w:r>
</w:p>`;

      const pNode = defaultXmlAdapter.parse(pXml);
      const paragraph = paragraphParser.parseParagraph(pNode);

      expect(paragraph.children.length).toBe(3);
      expect(paragraph.children[1]?.commentId).toBe('99');
      expect(paragraph.children[1]?.text).toBe('');
    });
  });

  describe('Line breaker and fragment comment annotation', () => {
    it('should propagate commentId into layout LineFragment', () => {
      const paragraph = {
        type: 'paragraph' as const,
        children: [
          { type: 'run' as const, text: 'Hello ' },
          { type: 'run' as const, text: 'world', commentId: 'c1' },
          { type: 'run' as const, text: '!' },
        ],
      };

      const lines = defaultLineBreaker.breakParagraph(paragraph, 500);
      expect(lines.length).toBeGreaterThan(0);

      const commentedFrag = lines[0]?.fragments.find((f) => f.commentId === 'c1');
      expect(commentedFrag).toBeDefined();
      expect(commentedFrag?.text).toBe('world');
    });
  });
});
