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
   * inline shape text renders in-flow instead of vanishing. Floating
   * shape text never drains: it renders inside its shape frame.
   * Absent on parser implementations without textbox support.
   */
  drainPendingBlocks?(): BlockNode[];
}

/** Mutable state threaded through inline-child parsing of one paragraph. */
interface InlineParseState {
  runs: RunNode[];
  /** First bookmark opened in the paragraph (becomes the paragraph id). */
  bookmarkName?: string;
  activeBookmark?: string;
  activeCommentId?: string;
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
   * True when the drawing node wraps its graphic in `wp:anchor`: the shape
   * floats and its textbox renders inside the shape frame, never as flow
   * siblings. Only direct children count (MCE Choice branches are already
   * unwrapped by the markup-compatibility pass, and `parseTextboxBlocks`
   * picks its container the same way): a descendant walk would reach an
   * inline picture nested inside the textbox content before the outer
   * anchor and misclassify the floating shape as inline.
   */
  private isFloatingDrawing(drawingNode: XmlNode): boolean {
    for (const node of drawingNode.children) {
      const tag = node.nodeName.replace(/^[a-zA-Z0-9]+:/, '').toLowerCase();
      if (tag === 'anchor') return true;
      if (tag === 'inline') return false;
    }
    return false;
  }

  /**
   * Extracts `wps:wsp` textbox paragraphs from a drawing node into the
   * pending block queue, and returns them so the caller can also stash a
   * copy on the parsed drawing node for `wps:txbx` round-trip (F-TXTBOX).
   * Floating shape text stays on the shape and lays out inside its frame
   * (F-TBXFLOAT); only inline shape text drains into the flow.
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
    if (!this.isFloatingDrawing(drawingNode)) {
      this.pendingBlocks.push(...blocks);
    }
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
    const state: InlineParseState = { runs: [] };

    for (const child of node.children) {
      const tag = child.nodeName.replace(/^[a-zA-Z0-9]+:/, '').toLowerCase();

      if (tag === 'ppr') {
        directPPrNode = child;
        const pStyle = child.children.find((c) => c.nodeName.toLowerCase().endsWith('pstyle'));
        if (pStyle) {
          styleId = pStyle.attributes['w:val'] ?? pStyle.attributes['val'];
        }
      } else {
        this.parseInlineChild(child, tag, state, styleResolver, imageResolver, hyperlinkResolver);
      }
    }
    const runs = state.runs;
    const bookmarkName = state.bookmarkName;


    const baseStyle = styleResolver?.resolveParagraphStyle(styleId) ?? {};
    const directStyle = parseParagraphProperties(directPPrNode);
    const combinedStyle = { ...baseStyle, ...directStyle };
    // Paragraph-mark font size for content-less lines (F-PMARK): the
    // direct w:pPr/w:rPr wins, otherwise the mark inherits its run
    // properties through the paragraph style chain down to docDefaults,
    // the same way a Title-styled empty line is 26pt tall in Word.
    if (combinedStyle.markFontSizePt === undefined) {
      const markRPr = directPPrNode?.children.find(
        (c) => c.nodeName.replace(/^[a-zA-Z0-9]+:/, '').toLowerCase() === 'rpr',
      );
      const directSize = markRPr ? parseRunProperties(markRPr).fontSizePt : undefined;
      const inheritedSize = styleResolver?.resolveRunStyle(styleId).fontSizePt;
      const markSize = directSize ?? inheritedSize;
      if (markSize !== undefined) combinedStyle.markFontSizePt = markSize;
    }

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
          prefixFontFamily: resolved.prefixFontFamily,
          prefixFontSizePt: resolved.prefixFontSizePt,
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

  /**
   * Unwraps a run-level w:sdt into its sdtContent runs (F-PSDT-RUN).
   * Only inline content is honored; nested sdt recurses.
   */
  /**
   * Parses one inline child of a paragraph (run, hyperlink, tracked
   * change, field, bookmark/comment marker, drawing, math, nested run-level
   * content control) into the shared run list. The same dispatcher serves
   * the paragraph body and `w:sdtContent`, so a content control wrapping
   * a hyperlink or a tracked change keeps its text (F-PSDT-RUN).
   */
  private parseInlineChild(
    child: XmlNode,
    tag: string,
    state: InlineParseState,
    styleResolver?: StyleResolver,
    imageResolver?: ImageResolver,
    hyperlinkResolver?: HyperlinkResolver,
  ): void {
    if (tag === 'bookmarkstart') {
        const name = child.attributes['w:name'] ?? child.attributes['name'];
        if (name && name !== '_GoBack') {
          state.activeBookmark = name;
          if (!state.bookmarkName) state.bookmarkName = name;
        }
      } else if (tag === 'bookmarkend') {
        state.activeBookmark = undefined;
      } else if (tag === 'commentrangestart') {
        const cId = child.attributes['w:id'] ?? child.attributes['id'];
        if (cId) state.activeCommentId = cId;
      } else if (tag === 'commentrangeend') {
        const cId = child.attributes['w:id'] ?? child.attributes['id'];
        if (state.activeCommentId === cId || !cId) state.activeCommentId = undefined;
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
            if (state.activeBookmark && !r.bookmarkName) r.bookmarkName = state.activeBookmark;
            if (state.activeCommentId && !r.commentId) r.commentId = state.activeCommentId;
            state.runs.push(r);
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
            if (state.activeBookmark && !r.bookmarkName) r.bookmarkName = state.activeBookmark;
            if (state.activeCommentId && !r.commentId) r.commentId = state.activeCommentId;
            const isPureCommentRef = r.commentId && !r.text && !r.drawing && !r.image && !r.footnoteRef && !r.field;
            if (!isPureCommentRef || !state.runs.some((prev) => prev.commentId === r.commentId)) {
              state.runs.push(r);
            }
          } else if (hTag === 'fldsimple') {
            const instr = (hChild.attributes['w:instr'] ?? hChild.attributes['instr'] ?? '').trim();
            const fieldType = classifyFieldInstruction(instr);
            for (const fChild of hChild.children) {
              if (fChild.nodeName.replace(/^[a-zA-Z0-9]+:/, '').toLowerCase() === 'r') {
                const r = this.parseRun(fChild, styleResolver, imageResolver);
                r.field = fieldType;
                r.hyperlink = hyperlinkInfo;
                if (state.activeBookmark && !r.bookmarkName) r.bookmarkName = state.activeBookmark;
                if (state.activeCommentId && !r.commentId) r.commentId = state.activeCommentId;
                const isPureCommentRef = r.commentId && !r.text && !r.drawing && !r.image && !r.footnoteRef && !r.field;
                if (!isPureCommentRef || !state.runs.some((prev) => prev.commentId === r.commentId)) {
                  state.runs.push(r);
                }
              }
            }
          }
        }
      } else if (tag === 'r') {
        const r = this.parseRun(child, styleResolver, imageResolver);
        if (state.activeBookmark && !r.bookmarkName) r.bookmarkName = state.activeBookmark;
        if (state.activeCommentId && !r.commentId) r.commentId = state.activeCommentId;
        const isPureCommentRef = r.commentId && !r.text && !r.drawing && !r.image && !r.footnoteRef && !r.field;
        if (!isPureCommentRef || !state.runs.some((prev) => prev.commentId === r.commentId)) {
          state.runs.push(r);
        }
      } else if (tag === 'sdt') {
        // Run-level content controls unwrap to their inline state.runs
        // (F-PSDT-RUN). Block-level sdt is handled by sdt-parser.
        this.parseRunLevelSdt(child, state, styleResolver, imageResolver, hyperlinkResolver);
      } else if (tag === 'omathpara' || tag === 'omath') {
        // Equations degrade to their literal text instead of being
        // dropped (F-PMATH). The plain-text run round-trips as w:r/w:t.
        const mathText = this.collectMathText(child);
        if (mathText.length > 0) {
          state.runs.push({ type: 'run', text: mathText, bookmarkName: state.activeBookmark });
        }
      } else if (tag === 'fldsimple') {
        const instr = (child.attributes['w:instr'] ?? child.attributes['instr'] ?? '').trim();
        const fieldType = classifyFieldInstruction(instr);
        for (const fChild of child.children) {
          if (fChild.nodeName.replace(/^[a-zA-Z0-9]+:/, '').toLowerCase() === 'r') {
            const r = this.parseRun(fChild, styleResolver, imageResolver);
            r.field = fieldType;
            if (state.activeBookmark && !r.bookmarkName) r.bookmarkName = state.activeBookmark;
            if (state.activeCommentId && !r.commentId) r.commentId = state.activeCommentId;
            state.runs.push(r);
          }
        }
      } else if (tag === 'drawing' || tag === 'pict') {
        const parsedImage = parseImageNode(child, imageResolver);
        if (parsedImage) {
          state.runs.push({
            type: 'run',
            text: '',
            image: parsedImage,
            bookmarkName: state.activeBookmark,
          });
        } else {
          // Textbox shapes keep their drawing run (geometry renders) and
          // stash their paragraphs for wps:txbx round-trip; an inline
          // drained sibling copy keeps in-flow rendering working, while
          // floating text renders inside the shape frame (F-TBXFLOAT).
          const textboxBlocks = this.collectTextboxBlocks(child, imageResolver);
          const parsedDrawing = parseDrawingNode(child);
          if (parsedDrawing) {
            this.attachTextboxParagraphs(parsedDrawing, textboxBlocks);
            state.runs.push({
              type: 'run',
              text: '',
              drawing: parsedDrawing,
              bookmarkName: state.activeBookmark,
            });
          }
        }
    }
  }

  private parseRunLevelSdt(
    node: XmlNode,
    state: InlineParseState,
    styleResolver?: StyleResolver,
    imageResolver?: ImageResolver,
    hyperlinkResolver?: HyperlinkResolver,
  ): void {
    const content = node.children.find(
      (c) => c.nodeName.replace(/^[a-zA-Z0-9]+:/, '').toLowerCase() === 'sdtcontent',
    );
    for (const iChild of content?.children ?? []) {
      const iTag = iChild.nodeName.replace(/^[a-zA-Z0-9]+:/, '').toLowerCase();
      this.parseInlineChild(iChild, iTag, state, styleResolver, imageResolver, hyperlinkResolver);
    }
  }

  /** Collects literal m:t text under an OMML node (F-PMATH). */
  private collectMathText(node: XmlNode): string {
    let out = '';
    for (const child of node.children ?? []) {
      if (child.kind && child.kind !== 'element') {
        out += child.textContent ?? '';
        continue;
      }
      const tag = child.nodeName.replace(/^[a-zA-Z0-9]+:/, '').toLowerCase();
      if (tag === 't') {
        out += child.textContent ?? '';
      } else {
        out += this.collectMathText(child);
      }
    }
    return out;
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
