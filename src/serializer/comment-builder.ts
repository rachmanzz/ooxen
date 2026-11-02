import type { CommentNode } from '../types/ast.js';
import { defaultWmlBuilder, escapeXml, type WmlBuilder } from './wml-builder.js';

/**
 * Serializer for ISO/IEC 29500-1 Comments (word/comments.xml).
 */

export interface CommentBuilder {
  buildCommentsXml(comments: CommentNode[]): string;
}

export class StandardCommentBuilder implements CommentBuilder {
  private wmlBuilder: WmlBuilder;

  constructor(wmlBuilder: WmlBuilder = defaultWmlBuilder) {
    this.wmlBuilder = wmlBuilder;
  }

  buildCommentsXml(comments: CommentNode[]): string {
    const commentElements = comments
      .map((comment) => {
        const authorAttr = comment.author ? ` w:author="${escapeXml(comment.author)}"` : '';
        const dateAttr = comment.date ? ` w:date="${escapeXml(comment.date)}"` : '';
        const initialsAttr = comment.initials ? ` w:initials="${escapeXml(comment.initials)}"` : '';

        const paragraphs = comment.children
          .map((child) => {
            if (child.type === 'paragraph') {
              return this.wmlBuilder.buildParagraphXml(child);
            }
            return '    <w:p/>';
          })
          .join('\n');

        return `  <w:comment w:id="${escapeXml(comment.id)}"${authorAttr}${dateAttr}${initialsAttr}>\n${paragraphs}\n  </w:comment>`;
      })
      .join('\n');

    return [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
      commentElements,
      '</w:comments>',
    ]
      .filter(Boolean)
      .join('\n');
  }
}

export const defaultCommentBuilder = new StandardCommentBuilder();

export function buildCommentsXml(comments: CommentNode[]): string {
  return defaultCommentBuilder.buildCommentsXml(comments);
}
