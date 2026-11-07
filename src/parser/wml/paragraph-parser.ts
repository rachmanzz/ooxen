import type {
  BlockNode,
  DrawingShapeNode,
  FootnoteReference,
  HyperlinkInfo,
  ImageNode,
  ParagraphNode,
  RevisionInfo,
  RevisionType,
  RunNode,
  RunSegment,
} from '../../types/ast.js';
import { parseImageNode, type ImageResolver } from '../dml/image-parser.js';
import { parseDrawingNode, parseTextboxBlocks } from '../dml/shape-parser.js';
import type { XmlNode } from '../xml-adapter.js';
import type { NumberingResolver } from './numbering-resolver.js';
import { parseParagraphProperties, parseRunProperties, type StyleResolver } from './style-resolver.js';

/**
 * Hyperlink resolver for resolving external URL target relationships.
 */
export interface HyperlinkResolver {
  resolveHyperlink(relationshipId: string): string | undefined;
}

/**
 * Classifies a field instruction into a canonical field type. The word
 * boundary is required so that `PAGEREF _Toc1` is not misclassified as a
 * `PAGE` field (v2 N3); unknown instructions are kept verbatim.
 */
function classifyFieldInstruction(instr: string): string {
  const upper = instr.toUpperCase();
  if (/^PAGE(\s|$)/.test(upper)) return 'PAGE';
  if (/^NUMPAGES(\s|$)/.test(upper)) return 'NUMPAGES';
  return instr;
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
  /**
   * Drains shape-textbox paragraphs discovered while parsing the last
   * paragraph. Callers that own a block list (document, header/footer,
   * table cells) append these right after the parsed paragraph so
   * floating textbox content renders in-flow instead of vanishing.
   * Absent on parser implementations without textbox support.
   */
  drainPendingBlocks?(): BlockNode[];
}

export class StandardParagraphParser implements ParagraphParser {
  private pendingBlocks: BlockNode[] = [];
  private activeResolvers:
    | {
        styleResolver?: StyleResolver;
        numberingResolver?: NumberingResolver;
        hyperlinkResolver?: HyperlinkResolver;
      }
    | undefined;

  drainPendingBlocks(): BlockNode[] {
    const blocks = this.pendingBlocks;
    this.pendingBlocks = [];
    return blocks;
  }

  /**
   * Extracts `wps:wsp` textbox paragraphs from a drawing node into the
   * pending block queue, and returns them so the caller can also stash a
   * copy on the parsed drawing node for `wps:txbx` round-trip (F-TXTBOX).
   * The drained copy keeps rendering working until layout models
   * shape text natively.
   */
  private collectTextboxBlocks(drawingNode: XmlNode, imageResolver?: ImageResolver): BlockNode[] | undefined {
    const resolvers = this.activeResolvers;
    if (!resolvers) return undefined;
    const blocks = parseTextboxBlocks(
      drawingNode,
      this,
      resolvers.styleResolver,
      resolvers.numberingResolver,
      imageResolver,
      resolvers.hyperlinkResolver,
    );
    if (!blocks) return undefined;
    this.pendingBlocks.push(...blocks);
    return blocks;
  }

  /**
   * Attaches drained textbox paragraphs back onto their shape so the
   * writer can emit them inside `wps:txbx` (F-TXTBOX).
   */
  private attachTextboxParagraphs(shape: DrawingShapeNode, blocks: BlockNode[] | undefined): void {
    if (!blocks) return;
    const paras = blocks.filter((b): b is ParagraphNode => b.type === 'paragraph');
    if (paras.length > 0) shape.textbox = paras;
  }

  parseParagraph(
    node: XmlNode,
    styleResolver?: StyleResolver,
    numberingResolver?: NumberingResolver,
    imageResolver?: ImageResolver,
    hyperlinkResolver?: HyperlinkResolver,
  ): ParagraphNode {
    // Stash resolvers so nested run parsing can extract shape textboxes
    // (parseRun itself does not receive them). Save/restore so nested
    // textbox paragraphs parsed below keep the outer call intact.
    const prev = this.activeResolvers;
    this.activeResolvers = { styleResolver, numberingResolver, hyperlinkResolver };
    try {
      return this.parseParagraphInner(node, styleResolver, numberingResolver, imageResolver, hyperlinkResolver);
    } finally {
      this.activeResolvers = prev;
    }
  }

  private parseParagraphInner(
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
      } else if (tag === 'ins' || tag === 'del') {
        const revType: RevisionType = tag === 'ins' ? 'insert' : 'delete';
        const revId = child.attributes['w:id'] ?? child.attributes['id'];
        const revAuthor = child.attributes['w:author'] ?? child.attributes['author'];
        const revDate = child.attributes['w:date'] ?? child.attributes['date'];
        const revInfo: RevisionInfo = {
          type: revType,
          id: revId,
          author: revAuthor,
          date: revDate,
        };

        for (const rChild of child.children) {
          const rTag = rChild.nodeName.replace(/^[a-zA-Z0-9]+:/, '').toLowerCase();
          if (rTag === 'r') {
            const r = this.parseRun(rChild, styleResolver, imageResolver);
            r.revision = revInfo;
            if (activeBookmark && !r.bookmarkName) r.bookmarkName = activeBookmark;
            if (activeCommentId && !r.commentId) r.commentId = activeCommentId;
            runs.push(r);
          }
        }
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
            const fieldType = classifyFieldInstruction(instr);
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
        const fieldType = classifyFieldInstruction(instr);
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
          // Textbox shapes keep their drawing run (geometry renders) and
          // stash their paragraphs for wps:txbx round-trip; the drained
          // sibling copy keeps in-flow rendering working (F-TXTBOX).
          const textboxBlocks = this.collectTextboxBlocks(child, imageResolver);
          const parsedDrawing = parseDrawingNode(child);
          if (parsedDrawing) {
            this.attachTextboxParagraphs(parsedDrawing, textboxBlocks);
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
    let breakType: 'page' | 'column' | undefined;
    let isTab: boolean | undefined;
    // Exact content segments preserve the original interleaving of text,
    // tabs, and breaks (futures §5.1). Each w:t/delText element maps to its
    // own text segment so sibling text elements survive round-trips.
    const segments: RunSegment[] = [];
    const pushTextSegment = (value: string) => {
      if (value.length === 0) return;
      segments.push({ type: 'text', text: value });
    };

    for (const child of node.childNodes ?? node.children) {
      if (child.kind && child.kind !== 'element') continue;
      const tag = child.nodeName.replace(/^[a-zA-Z0-9]+:/, '').toLowerCase();

      if (tag === 'rpr') {
        directRPrNode = child;
        const rStyle = child.children.find((c) => c.nodeName.toLowerCase().endsWith('rstyle'));
        if (rStyle) {
          rStyleId = rStyle.attributes['w:val'] ?? rStyle.attributes['val'];
        }
      } else if (tag === 't' || tag === 'deltext') {
        const value = child.textContent;
        text += value;
        pushTextSegment(value);
      } else if (tag === 'instrtext') {
        field = classifyFieldInstruction(child.textContent.trim().toUpperCase());
      } else if (tag === 'br') {
        const brType = (child.attributes['w:type'] ?? child.attributes['type'] ?? '').toLowerCase();
        if (brType === 'page' || brType === 'column') {
          breakType = brType;
          segments.push({ type: 'break', breakType: brType });
        } else {
          text += '\n';
          segments.push({ type: 'break', breakType: 'line' });
        }
      } else if (tag === 'cr') {
        // <w:cr/> is a soft line break equivalent to <w:br/> (textWrapping).
        text += '\n';
        segments.push({ type: 'break', breakType: 'line' });
      } else if (tag === 'tab') {
        text += '\t';
        isTab = true;
        segments.push({ type: 'tab' });
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
          const textboxBlocks = this.collectTextboxBlocks(child, imageResolver);
          const parsedDrawing = parseDrawingNode(child);
          if (parsedDrawing) {
            this.attachTextboxParagraphs(parsedDrawing, textboxBlocks);
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
      breakType,
      isTab,
      segments: segments.length > 1 || (segments.length === 1 && segments[0]!.type !== 'text') ? segments : undefined,
    };
  }
}

export const defaultParagraphParser = new StandardParagraphParser();
