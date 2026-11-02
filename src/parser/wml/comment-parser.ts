import type { BlockNode, CommentNode } from '../../types/ast.js';
import type { ImageResolver } from '../dml/image-parser.js';
import { defaultXmlAdapter, type XmlAdapter } from '../xml-adapter.js';
import type { NumberingResolver } from './numbering-resolver.js';
import { defaultParagraphParser, type HyperlinkResolver, type ParagraphParser } from './paragraph-parser.js';
import type { StyleResolver } from './style-resolver.js';
import { defaultTableParser, type TableParser } from './table-parser.js';

/**
 * ISO/IEC 29500 WordprocessingML: Comments Parser (word/comments.xml).
 */

export interface CommentParser {
  parseCommentsXml(
    xml: string,
    styleResolver?: StyleResolver,
    numberingResolver?: NumberingResolver,
    imageResolver?: ImageResolver,
    hyperlinkResolver?: HyperlinkResolver,
    paragraphParser?: ParagraphParser,
    tableParser?: TableParser,
  ): CommentNode[];
}

export class StandardCommentParser implements CommentParser {
  private xmlAdapter: XmlAdapter;

  constructor(xmlAdapter: XmlAdapter = defaultXmlAdapter) {
    this.xmlAdapter = xmlAdapter;
  }

  parseCommentsXml(
    xml: string,
    styleResolver?: StyleResolver,
    numberingResolver?: NumberingResolver,
    imageResolver?: ImageResolver,
    hyperlinkResolver?: HyperlinkResolver,
    paragraphParser: ParagraphParser = defaultParagraphParser,
    tableParser: TableParser = defaultTableParser,
  ): CommentNode[] {
    const root = this.xmlAdapter.parse(xml);
    const comments: CommentNode[] = [];

    const commentNodes = root.children.filter((c) => c.nodeName.replace(/^[a-zA-Z0-9]+:/, '').toLowerCase() === 'comment');

    for (const cNode of commentNodes) {
      const id = cNode.attributes['w:id'] ?? cNode.attributes['id'] ?? '';
      const author = cNode.attributes['w:author'] ?? cNode.attributes['author'];
      const date = cNode.attributes['w:date'] ?? cNode.attributes['date'];
      const initials = cNode.attributes['w:initials'] ?? cNode.attributes['initials'];

      const children: BlockNode[] = [];
      for (const bChild of cNode.children) {
        const bTag = bChild.nodeName.replace(/^[a-zA-Z0-9]+:/, '').toLowerCase();
        if (bTag === 'p') {
          children.push(paragraphParser.parseParagraph(bChild, styleResolver, numberingResolver, imageResolver, hyperlinkResolver));
        } else if (bTag === 'tbl') {
          children.push(tableParser.parseTable(bChild, styleResolver, numberingResolver));
        }
      }

      comments.push({
        type: 'comment',
        id: String(id),
        author,
        date,
        initials,
        children,
      });
    }

    return comments;
  }
}

export const defaultCommentParser = new StandardCommentParser();

export function parseCommentsXml(
  xml: string,
  styleResolver?: StyleResolver,
  numberingResolver?: NumberingResolver,
  imageResolver?: ImageResolver,
  hyperlinkResolver?: HyperlinkResolver,
  paragraphParser?: ParagraphParser,
  tableParser?: TableParser,
): CommentNode[] {
  return defaultCommentParser.parseCommentsXml(
    xml,
    styleResolver,
    numberingResolver,
    imageResolver,
    hyperlinkResolver,
    paragraphParser,
    tableParser,
  );
}
