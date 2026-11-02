import type {
  DrawingShapeNode,
  FootnoteReference,
  HyperlinkInfo,
  ImageNode,
  ParagraphNode,
  RunNode,
} from '../../types/ast.js';
import { parseImageNode, type ImageResolver } from '../dml/image-parser.js';
import { parseDrawingNode } from '../dml/shape-parser.js';
import type { XmlNode } from '../xml-adapter.js';
import type { NumberingResolver } from './numbering-resolver.js';
import { parseParagraphProperties, parseRunProperties, type StyleResolver } from './style-resolver.js';

/**
 * Hyperlink resolver for resolving external URL target relationships.
 */
export interface HyperlinkResolver {
  resolveHyperlink(relationshipId: string): string | undefined;
}

export class MapHyperlinkResolver implements HyperlinkResolver {
  private links = new Map<string, string>();

  register(relationshipId: string, url: string): void {
    this.links.set(relationshipId, url);
  }

  resolveHyperlink(relationshipId: string): string | undefined {
    return this.links.get(relationshipId);
  }
}

/**
 * Parser for w:p (paragraphs) and w:r (runs) into AST nodes.
 */

export interface ParagraphParser {
  parseParagraph(
    node: XmlNode,
    styleResolver?: StyleResolver,
    numberingResolver?: NumberingResolver,
    imageResolver?: ImageResolver,
    hyperlinkResolver?: HyperlinkResolver,
  ): ParagraphNode;
  parseRun(node: XmlNode, inheritedStyle?: StyleResolver, imageResolver?: ImageResolver): RunNode;
}

export class StandardParagraphParser implements ParagraphParser {
  parseParagraph(
    node: XmlNode,
    styleResolver?: StyleResolver,
    numberingResolver?: NumberingResolver,
    imageResolver?: ImageResolver,
    hyperlinkResolver?: HyperlinkResolver,
  ): ParagraphNode {
    let styleId: string | undefined;
    let directPPrNode: XmlNode | undefined;
    let bookmarkName: string | undefined;
    let activeBookmark: string | undefined;
    let activeCommentId: string | undefined;
    const runs: RunNode[] = [];

    for (const child of node.children) {
      const tag = child.nodeName.replace(/^[a-zA-Z0-9]+:/, '').toLowerCase();

      if (tag === 'ppr') {
        directPPrNode = child;
        const pStyle = child.children.find((c) => c.nodeName.toLowerCase().endsWith('pstyle'));
        if (pStyle) {
          styleId = pStyle.attributes['w:val'] ?? pStyle.attributes['val'];
        }
      } else if (tag === 'bookmarkstart') {
        const name = child.attributes['w:name'] ?? child.attributes['name'];
        if (name && name !== '_GoBack') {
          activeBookmark = name;
          if (!bookmarkName) bookmarkName = name;
        }
      } else if (tag === 'bookmarkend') {
        activeBookmark = undefined;
      } else if (tag === 'commentrangestart') {
        const cId = child.attributes['w:id'] ?? child.attributes['id'];
        if (cId) activeCommentId = cId;
      } else if (tag === 'commentrangeend') {
        const cId = child.attributes['w:id'] ?? child.attributes['id'];
        if (activeCommentId === cId || !cId) activeCommentId = undefined;
      } else if (tag === 'hyperlink') {
        const relId = child.attributes['r:id'] ?? child.attributes['id'] ?? child.attributes['w:id'];
        const anchor = child.attributes['w:anchor'] ?? child.attributes['anchor'];
        const tooltip = child.attributes['w:tooltip'] ?? child.attributes['tooltip'];
        const url = relId && hyperlinkResolver ? hyperlinkResolver.resolveHyperlink(relId) : undefined;
        const hyperlinkInfo: HyperlinkInfo = {
          url,
          anchor,
          tooltip,
        };

        for (const hChild of child.children) {
          const hTag = hChild.nodeName.replace(/^[a-zA-Z0-9]+:/, '').toLowerCase();
          if (hTag === 'r') {
            const r = this.parseRun(hChild, styleResolver, imageResolver);
            r.hyperlink = hyperlinkInfo;
            if (activeBookmark && !r.bookmarkName) r.bookmarkName = activeBookmark;
            if (activeCommentId && !r.commentId) r.commentId = activeCommentId;
            const isPureCommentRef = r.commentId && !r.text && !r.drawing && !r.image && !r.footnoteRef && !r.field;
            if (!isPureCommentRef || !runs.some((prev) => prev.commentId === r.commentId)) {
              runs.push(r);
            }
          } else if (hTag === 'fldsimple') {
            const instr = (hChild.attributes['w:instr'] ?? hChild.attributes['instr'] ?? '').trim();
            const fieldType = instr.toUpperCase().startsWith('PAGE')
              ? 'PAGE'
              : instr.toUpperCase().startsWith('NUMPAGES')
                ? 'NUMPAGES'
                : instr;
            for (const fChild of hChild.children) {
              if (fChild.nodeName.replace(/^[a-zA-Z0-9]+:/, '').toLowerCase() === 'r') {
                const r = this.parseRun(fChild, styleResolver, imageResolver);
                r.field = fieldType;
                r.hyperlink = hyperlinkInfo;
                if (activeBookmark && !r.bookmarkName) r.bookmarkName = activeBookmark;
                if (activeCommentId && !r.commentId) r.commentId = activeCommentId;
                const isPureCommentRef = r.commentId && !r.text && !r.drawing && !r.image && !r.footnoteRef && !r.field;
                if (!isPureCommentRef || !runs.some((prev) => prev.commentId === r.commentId)) {
                  runs.push(r);
                }
              }
            }
          }
        }
      } else if (tag === 'r') {
        const r = this.parseRun(child, styleResolver, imageResolver);
        if (activeBookmark && !r.bookmarkName) r.bookmarkName = activeBookmark;
        if (activeCommentId && !r.commentId) r.commentId = activeCommentId;
        const isPureCommentRef = r.commentId && !r.text && !r.drawing && !r.image && !r.footnoteRef && !r.field;
        if (!isPureCommentRef || !runs.some((prev) => prev.commentId === r.commentId)) {
          runs.push(r);
        }
      } else if (tag === 'fldsimple') {
        const instr = (child.attributes['w:instr'] ?? child.attributes['instr'] ?? '').trim();
        const fieldType = instr.toUpperCase().startsWith('PAGE')
          ? 'PAGE'
          : instr.toUpperCase().startsWith('NUMPAGES')
            ? 'NUMPAGES'
            : instr;
        for (const fChild of child.children) {
          if (fChild.nodeName.replace(/^[a-zA-Z0-9]+:/, '').toLowerCase() === 'r') {
            const r = this.parseRun(fChild, styleResolver, imageResolver);
            r.field = fieldType;
            if (activeBookmark && !r.bookmarkName) r.bookmarkName = activeBookmark;
            if (activeCommentId && !r.commentId) r.commentId = activeCommentId;
            runs.push(r);
          }
        }
      } else if (tag === 'drawing' || tag === 'pict') {
        const parsedImage = parseImageNode(child, imageResolver);
        if (parsedImage) {
          runs.push({
            type: 'run',
            text: '',
            image: parsedImage,
            bookmarkName: activeBookmark,
          });
        } else {
          const parsedDrawing = parseDrawingNode(child);
          if (parsedDrawing) {
            runs.push({
              type: 'run',
              text: '',
              drawing: parsedDrawing,
              bookmarkName: activeBookmark,
            });
          }
        }
      }
    }

    const baseStyle = styleResolver?.resolveParagraphStyle(styleId) ?? {};
    const directStyle = parseParagraphProperties(directPPrNode);
    const combinedStyle = { ...baseStyle, ...directStyle };

    if (combinedStyle.numbering?.numId) {
      const resolved = numberingResolver?.resolveNumbering(
        combinedStyle.numbering.numId,
        combinedStyle.numbering.level,
      );
      if (resolved) {
        combinedStyle.numbering = {
          numId: resolved.numId,
          level: resolved.level,
          format: resolved.format,
          prefixText: resolved.prefixText,
        };
        if (resolved.indentLeftPt !== undefined && combinedStyle.indentLeftPt === undefined) {
          combinedStyle.indentLeftPt = resolved.indentLeftPt;
        }
        if (resolved.hangingPt !== undefined && combinedStyle.firstLineIndentPt === undefined) {
          combinedStyle.firstLineIndentPt = -resolved.hangingPt;
        }
      }
    }

    return {
      type: 'paragraph',
      style: Object.keys(combinedStyle).length > 0 ? combinedStyle : undefined,
      bookmarkName,
      children: runs,
    };
  }

  parseRun(node: XmlNode, styleResolver?: StyleResolver, imageResolver?: ImageResolver): RunNode {
    let directRPrNode: XmlNode | undefined;
    let rStyleId: string | undefined;
    let text = '';
    let drawing: DrawingShapeNode | undefined;
    let image: ImageNode | undefined;
    let field: string | undefined;
    let footnoteRef: FootnoteReference | undefined;
    let isFootnoteRefMark: boolean | undefined;
    let commentId: string | undefined;

    for (const child of node.children) {
      const tag = child.nodeName.replace(/^[a-zA-Z0-9]+:/, '').toLowerCase();

      if (tag === 'rpr') {
        directRPrNode = child;
        const rStyle = child.children.find((c) => c.nodeName.toLowerCase().endsWith('rstyle'));
        if (rStyle) {
          rStyleId = rStyle.attributes['w:val'] ?? rStyle.attributes['val'];
        }
      } else if (tag === 't') {
        text += child.textContent;
      } else if (tag === 'instrtext') {
        const instr = child.textContent.trim().toUpperCase();
        if (instr.startsWith('PAGE')) {
          field = 'PAGE';
        } else if (instr.startsWith('NUMPAGES')) {
          field = 'NUMPAGES';
        } else {
          field = instr;
        }
      } else if (tag === 'br') {
        text += '\n';
      } else if (tag === 'tab') {
        text += '\t';
      } else if (tag === 'footnotereference') {
        const idStr = child.attributes['w:id'] ?? child.attributes['id'];
        const id = idStr ? Number(idStr) : 1;
        footnoteRef = { id, kind: 'footnote' };
        if (!text) text = `[${id}]`;
      } else if (tag === 'endnotereference') {
        const idStr = child.attributes['w:id'] ?? child.attributes['id'];
        const id = idStr ? Number(idStr) : 1;
        footnoteRef = { id, kind: 'endnote' };
        if (!text) text = `[${id}]`;
      } else if (tag === 'footnoteref' || tag === 'endnoteref') {
        isFootnoteRefMark = true;
      } else if (tag === 'commentreference') {
        const idStr = child.attributes['w:id'] ?? child.attributes['id'];
        if (idStr) {
          commentId = idStr;
        }
      } else if (tag === 'drawing' || tag === 'pict') {
        const parsedImage = parseImageNode(child, imageResolver);
        if (parsedImage) {
          image = parsedImage;
        } else {
          const parsedDrawing = parseDrawingNode(child);
          if (parsedDrawing) {
            drawing = parsedDrawing;
          }
        }
      }
    }

    const baseStyle = styleResolver?.resolveRunStyle(rStyleId) ?? {};
    const directStyle = parseRunProperties(directRPrNode);
    const combinedStyle = { ...baseStyle, ...directStyle };

    return {
      type: 'run',
      text,
      style: Object.keys(combinedStyle).length > 0 ? combinedStyle : undefined,
      drawing,
      image,
      field,
      footnoteRef,
      isFootnoteRefMark,
      commentId,
    };
  }
}

export const defaultParagraphParser = new StandardParagraphParser();
