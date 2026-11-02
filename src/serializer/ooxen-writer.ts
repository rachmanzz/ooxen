import { KNOWN_RELATIONSHIPS, type OpcRelationship } from '../opc/relationships.js';
import { guessMimeType } from '../parser/dml/image-parser.js';
import { generatePresetGeometry, parseSvgPathToCommands } from '../parser/dml/shape-parser.js';
import { defaultXmlAdapter, type XmlAdapter, type XmlNode } from '../parser/xml-adapter.js';
import type {
  BlockNode,
  CommentNode,
  DocumentMetadata,
  DocumentNode,
  DrawingShapeNode,
  FootnoteNode,
  HeaderFooterNode,
  HyperlinkInfo,
  ImageNode,
  ParagraphNode,
  RunNode,
  SectionColumns,
  SectionNode,
  TableCellNode,
  TableNode,
  TableRowNode,
} from '../types/ast.js';
import { base64ToUint8Array } from '../types/common.js';
import type { ParagraphStyle, TableCellStyle, TableStyle, TextStyle } from '../types/style.js';
import { defaultPackageBuilder, type HeaderFooterPart, type ImageMediaPart, type PackageBuilder } from './package-builder.js';
import { defaultWmlBuilder, type WmlBuilder } from './wml-builder.js';

/**
 * Public export API converting Document AST or XML-HTML to an OOXML (.docx) Uint8Array buffer.
 */

export interface OoxenWriter {
  write(document: DocumentNode): Promise<Uint8Array>;
  writeFromHtml(xhtmlString: string): Promise<Uint8Array>;
}

export class StandardOoxenWriter implements OoxenWriter {
  private wmlBuilder: WmlBuilder;
  private packageBuilder: PackageBuilder;
  private xmlAdapter: XmlAdapter;

  constructor(
    wmlBuilder: WmlBuilder = defaultWmlBuilder,
    packageBuilder: PackageBuilder = defaultPackageBuilder,
    xmlAdapter: XmlAdapter = defaultXmlAdapter,
  ) {
    this.wmlBuilder = wmlBuilder;
    this.packageBuilder = packageBuilder;
    this.xmlAdapter = xmlAdapter;
  }

  async write(document: DocumentNode): Promise<Uint8Array> {
    const mediaParts: ImageMediaPart[] = [];
    let imgCounter = 1;

    const processImage = (img: ImageNode): void => {
      const relId = img.relationshipId || `rIdImg${imgCounter++}`;
      img.relationshipId = relId;

      let rawData: Uint8Array | undefined = img.data;
      let mimeType = img.mimeType || 'image/png';

      if (!rawData && img.src?.startsWith('data:')) {
        const matches = img.src.match(/^data:([^;]+);base64,(.+)$/);
        if (matches) {
          mimeType = matches[1] || mimeType;
          rawData = base64ToUint8Array(matches[2]!);
        }
      }

      if (rawData) {
        const ext = mimeType.replace(/^image\//, '').replace(/\+xml$/, '') || 'png';
        const partName = `word/media/image${imgCounter}.${ext}`;
        mediaParts.push({
          partName,
          relationshipId: relId,
          contentType: mimeType,
          data: rawData,
        });
      }
    };

    const externalRelationships: OpcRelationship[] = [];
    const hyperlinkRelIds = new Map<string, string>();
    let linkCounter = 1;

    const processHyperlink = (url?: string): void => {
      if (url && !hyperlinkRelIds.has(url)) {
        const relId = `rIdLink${linkCounter++}`;
        hyperlinkRelIds.set(url, relId);
        externalRelationships.push({
          id: relId,
          type: KNOWN_RELATIONSHIPS.HYPERLINK,
          target: url,
          targetMode: 'External',
        });
      }
    };

    const traverseBlock = (block: BlockNode): void => {
      if (block.type === 'image') {
        processImage(block);
      } else if (block.type === 'paragraph') {
        for (const r of block.children) {
          if (r.image) processImage(r.image);
          if (r.hyperlink?.url) processHyperlink(r.hyperlink.url);
        }
      } else if (block.type === 'table') {
        for (const row of block.rows) {
          for (const cell of row.children) {
            for (const child of cell.children) {
              traverseBlock(child);
            }
          }
        }
      }
    };

    const headerFooterParts: HeaderFooterPart[] = [];
    const headerFooterRelIds = new Map<HeaderFooterNode, string>();
    let hdrCounter = 1;
    let ftrCounter = 1;

    for (const section of document.sections) {
      for (const block of section.children) {
        traverseBlock(block);
      }

      if (section.headers) {
        for (const kind of ['default', 'first', 'even'] as const) {
          const node = section.headers[kind];
          if (node && !headerFooterRelIds.has(node)) {
            for (const b of node.children) traverseBlock(b);
            const relId = `rIdHdr${hdrCounter}`;
            const partName = `word/header${hdrCounter}.xml`;
            hdrCounter++;
            headerFooterRelIds.set(node, relId);
            const xml = this.wmlBuilder.buildHeaderXml(node, hyperlinkRelIds);
            headerFooterParts.push({
              partName,
              relationshipId: relId,
              type: 'header',
              xml,
            });
          }
        }
      }

      if (section.footers) {
        for (const kind of ['default', 'first', 'even'] as const) {
          const node = section.footers[kind];
          if (node && !headerFooterRelIds.has(node)) {
            for (const b of node.children) traverseBlock(b);
            const relId = `rIdFtr${ftrCounter}`;
            const partName = `word/footer${ftrCounter}.xml`;
            ftrCounter++;
            headerFooterRelIds.set(node, relId);
            const xml = this.wmlBuilder.buildFooterXml(node, hyperlinkRelIds);
            headerFooterParts.push({
              partName,
              relationshipId: relId,
              type: 'footer',
              xml,
            });
          }
        }
      }
    }

    const documentXml = this.wmlBuilder.buildDocumentXml(document, headerFooterRelIds, hyperlinkRelIds);
    const pkg = this.packageBuilder.assemblePackage(
      documentXml,
      undefined,
      undefined,
      mediaParts,
      headerFooterParts,
      externalRelationships,
      document.metadata,
      document.footnotes,
      document.endnotes,
      undefined,
      undefined,
      document.comments,
    );
    return pkg.serialize();
  }

  async writeFromHtml(xhtmlString: string): Promise<Uint8Array> {
    const rootNode = this.xmlAdapter.parse(xhtmlString);
    const doc = this.parseHtmlToAst(rootNode);
    return this.write(doc);
  }

  private extractMetadataFromHtml(rootNode: XmlNode): DocumentMetadata | undefined {
    const metadata: DocumentMetadata = {};
    let found = false;

    const traverse = (node: XmlNode): void => {
      const tag = node.nodeName.toLowerCase().replace(/^[a-zA-Z0-9]+:/, '');
      if (tag === 'title' && node.textContent?.trim()) {
        metadata.title = node.textContent.trim();
        found = true;
      } else if (tag === 'meta') {
        const name = (node.attributes['name'] ?? node.attributes['property'] ?? '').toLowerCase();
        const content = (node.attributes['content'] ?? '').trim();
        if (content) {
          if (name === 'author' || name === 'creator') {
            metadata.creator = content;
            found = true;
          } else if (name === 'description') {
            metadata.description = content;
            found = true;
          } else if (name === 'keywords') {
            metadata.keywords = content
              .split(/[,;]/)
              .map((k) => k.trim())
              .filter(Boolean);
            found = true;
          } else if (name === 'subject') {
            metadata.subject = content;
            found = true;
          } else if (name === 'generator') {
            metadata.application = content;
            found = true;
          }
        }
      }

      for (const child of node.children) {
        traverse(child);
      }
    };

    traverse(rootNode);
    return found ? metadata : undefined;
  }

  private findFirstNode(root: XmlNode, predicate: (n: XmlNode) => boolean): XmlNode | undefined {
    for (const child of root.children) {
      if (predicate(child)) return child;
      const found = this.findFirstNode(child, predicate);
      if (found) return found;
    }
    return undefined;
  }

  private extractFootnotesFromHtml(container: XmlNode): {
    footnotes?: FootnoteNode[];
    endnotes?: FootnoteNode[];
  } {
    let footnotes: FootnoteNode[] | undefined;
    let endnotes: FootnoteNode[] | undefined;

    const findAsides = (node: XmlNode): void => {
      const tag = node.nodeName.toLowerCase().replace(/^[a-zA-Z0-9]+:/, '');
      const cls = (node.attributes['class'] ?? '').toLowerCase();

      if (tag === 'aside' && cls.includes('footnotes')) {
        const listItems = this.findAllNodes(node, (n) => n.nodeName.toLowerCase().endsWith('li'));
        footnotes = listItems.map((li) => {
          const idStr = (li.attributes['id'] ?? '').replace(/^fn-/, '');
          const id = Number(idStr) || 1;
          const blocks = this.parseBlockNodes(li.children);
          return {
            type: 'footnote' as const,
            kind: 'footnote' as const,
            id,
            children:
              blocks.length > 0
                ? blocks
                : [{ type: 'paragraph' as const, children: [{ type: 'run' as const, text: li.textContent }] }],
          };
        });
      } else if (tag === 'aside' && cls.includes('endnotes')) {
        const listItems = this.findAllNodes(node, (n) => n.nodeName.toLowerCase().endsWith('li'));
        endnotes = listItems.map((li) => {
          const idStr = (li.attributes['id'] ?? '').replace(/^en-/, '');
          const id = Number(idStr) || 1;
          const blocks = this.parseBlockNodes(li.children);
          return {
            type: 'endnote' as const,
            kind: 'endnote' as const,
            id,
            children:
              blocks.length > 0
                ? blocks
                : [{ type: 'paragraph' as const, children: [{ type: 'run' as const, text: li.textContent }] }],
          };
        });
      }

      for (const child of node.children) {
        findAsides(child);
      }
    };

    findAsides(container);
    return { footnotes, endnotes };
  }

  private findAllNodes(root: XmlNode, predicate: (n: XmlNode) => boolean): XmlNode[] {
    const result: XmlNode[] = [];
    const traverse = (node: XmlNode): void => {
      if (predicate(node)) result.push(node);
      for (const child of node.children) traverse(child);
    };
    traverse(root);
    return result;
  }

  private parseHtmlToAst(rootNode: XmlNode): DocumentNode {
    const metadata = this.extractMetadataFromHtml(rootNode);
    const { footnotes, endnotes } = this.extractFootnotesFromHtml(rootNode);
    const comments = this.extractCommentsFromHtml(rootNode);

    let container = rootNode;
    const bodyNode = this.findFirstNode(rootNode, (n) => {
      const tag = n.nodeName.toLowerCase().replace(/^[a-zA-Z0-9]+:/, '');
      return tag === 'body' || tag === 'article';
    });
    if (bodyNode) {
      const articleNode = this.findFirstNode(bodyNode, (n) => {
        const tag = n.nodeName.toLowerCase().replace(/^[a-zA-Z0-9]+:/, '');
        return tag === 'article';
      });
      container = articleNode ?? bodyNode;
    }

    const sections: SectionNode[] = [];
    const sectionNodes = container.children.filter((c) => c.nodeName.toLowerCase().endsWith('section'));

    if (sectionNodes.length === 0) {
      // Fallback: entire container is one section
      sections.push(this.parseSectionFromHtmlNodes(container.children, container));
    } else {
      for (const sNode of sectionNodes) {
        sections.push(this.parseSectionFromHtmlNodes(sNode.children, sNode));
      }
    }

    return {
      type: 'document',
      sections,
      metadata,
      footnotes,
      endnotes,
      comments,
    };
  }

  private extractCommentsFromHtml(rootNode: XmlNode): CommentNode[] | undefined {
    const aside = this.findFirstNode(
      rootNode,
      (n) =>
        n.nodeName.toLowerCase().replace(/^[a-zA-Z0-9]+:/, '') === 'aside' &&
        (n.attributes['class'] ?? '').includes('ooxen-comments'),
    );
    if (!aside) return undefined;

    const comments: CommentNode[] = [];
    for (const card of aside.children) {
      const cardTag = card.nodeName.toLowerCase().replace(/^[a-zA-Z0-9]+:/, '');
      if (cardTag === 'div') {
        const id = (card.attributes['id'] ?? '').replace(/^comment-/, '');
        const author = card.attributes['data-author'];
        const date = card.attributes['data-date'];
        const initials = card.attributes['data-initials'];

        const bodyChildren = card.children.filter((c) => {
          const cTag = c.nodeName.toLowerCase().replace(/^[a-zA-Z0-9]+:/, '');
          return cTag === 'p' || cTag === 'div' || cTag === 'table';
        });

        comments.push({
          type: 'comment',
          id: id || '1',
          author,
          date,
          initials,
          children: this.parseBlockNodes(bodyChildren.length > 0 ? bodyChildren : card.children),
        });
      }
    }

    return comments.length > 0 ? comments : undefined;
  }

  private parseSectionFromHtmlNodes(nodes: XmlNode[], sectionNode?: XmlNode): SectionNode {
    let headerNode: HeaderFooterNode | undefined;
    let footerNode: HeaderFooterNode | undefined;
    const bodyNodes: XmlNode[] = [];

    for (const node of nodes) {
      const tag = node.nodeName.toLowerCase().replace(/^[a-zA-Z0-9]+:/, '');
      if (tag === 'header') {
        headerNode = {
          type: 'header',
          kind: 'default',
          children: this.parseBlockNodes(node.children),
        };
      } else if (tag === 'footer') {
        footerNode = {
          type: 'footer',
          kind: 'default',
          children: this.parseBlockNodes(node.children),
        };
      } else if (tag === 'aside') {
        // Handled as document-level footnotes/endnotes
        continue;
      } else {
        bodyNodes.push(node);
      }
    }

    const css = sectionNode ? this.parseCssStyle(sectionNode.attributes['style']) : {};
    let columns: SectionColumns | undefined;
    if (css['column-count']) {
      const count = Number(css['column-count']);
      if (!Number.isNaN(count) && count > 1) {
        let spacePt = 36;
        if (css['column-gap']?.endsWith('pt')) {
          spacePt = Number.parseFloat(css['column-gap']);
        }
        const separator = css['column-rule'] && css['column-rule'] !== 'none';
        columns = {
          count,
          spacePt,
          separator: separator ? true : undefined,
        };
      }
    }

    return {
      type: 'section',
      properties: {
        pageSize: { width: 612, height: 792 },
        margins: { top: 72, right: 72, bottom: 72, left: 72 },
        columns,
      },
      children: this.parseBlockNodes(bodyNodes),
      headers: headerNode ? { default: headerNode } : undefined,
      footers: footerNode ? { default: footerNode } : undefined,
    };
  }

  private parseBlockNodes(nodes: XmlNode[]): BlockNode[] {
    const blocks: BlockNode[] = [];

    for (const node of nodes) {
      const tag = node.nodeName.toLowerCase().replace(/^[a-zA-Z0-9]+:/, '');
      if (tag === 'p') {
        blocks.push(this.parseHtmlParagraph(node));
      } else if (tag === 'table') {
        blocks.push(this.parseHtmlTable(node));
      } else if (tag === 'svg') {
        const shape = this.parseSvgNode(node);
        if (shape) blocks.push(shape);
      } else if (tag === 'img') {
        const img = this.parseHtmlImage(node);
        if (img) blocks.push(img);
      } else if (tag === 'ul' || tag === 'ol') {
        const numId = tag === 'ul' ? 1 : 2;
        this.parseHtmlList(node, numId, 0, blocks);
      }
    }

    return blocks;
  }

  private parseHtmlList(listNode: XmlNode, numId: number, level: number, outBlocks: BlockNode[]): void {
    for (const child of listNode.children) {
      const tag = child.nodeName.toLowerCase().replace(/^[a-zA-Z0-9]+:/, '');
      if (tag === 'li') {
        const p = this.parseHtmlParagraph(child);
        p.style = {
          ...p.style,
          numbering: {
            numId,
            level,
          },
        };
        outBlocks.push(p);

        for (const subChild of child.children) {
          const subTag = subChild.nodeName.toLowerCase().replace(/^[a-zA-Z0-9]+:/, '');
          if (subTag === 'ul' || subTag === 'ol') {
            const subNumId = subTag === 'ul' ? 1 : 2;
            this.parseHtmlList(subChild, subNumId, level + 1, outBlocks);
          }
        }
      } else if (tag === 'ul' || tag === 'ol') {
        const subNumId = tag === 'ul' ? 1 : 2;
        this.parseHtmlList(child, subNumId, level + 1, outBlocks);
      }
    }
  }

  private parseHtmlImage(imgNode: XmlNode): ImageNode | undefined {
    const src = imgNode.attributes['src'] ?? '';
    const alt = imgNode.attributes['alt'] ?? imgNode.attributes['title'];
    const wStr = imgNode.attributes['width'];
    const hStr = imgNode.attributes['height'];

    let widthPt = 150;
    let heightPt = 100;

    if (wStr) {
      const num = Number.parseFloat(wStr.replace(/pt$/, ''));
      if (!Number.isNaN(num) && num > 0) widthPt = num;
    }
    if (hStr) {
      const num = Number.parseFloat(hStr.replace(/pt$/, ''));
      if (!Number.isNaN(num) && num > 0) heightPt = num;
    }

    let data: Uint8Array | undefined;
    let mimeType = guessMimeType(src);

    if (src.startsWith('data:')) {
      const match = src.match(/^data:([^;]+);base64,(.+)$/);
      if (match) {
        mimeType = match[1] || mimeType;
        data = base64ToUint8Array(match[2]!);
      }
    }

    return {
      type: 'image',
      altText: alt,
      widthPt,
      heightPt,
      src,
      data,
      mimeType,
    };
  }

  private parseSvgNode(svgNode: XmlNode): DrawingShapeNode | undefined {
    const widthPt = Number.parseFloat(svgNode.attributes['width'] ?? '100');
    const heightPt = Number.parseFloat(svgNode.attributes['height'] ?? '100');

    const pathNode = svgNode.children.find((c) => c.nodeName.toLowerCase().endsWith('path'));
    const d = pathNode?.attributes['d'] ?? '';
    const fill = pathNode?.attributes['fill'];
    const stroke = pathNode?.attributes['stroke'];
    const strokeWidth = Number.parseFloat(pathNode?.attributes['stroke-width'] ?? '1');

    const commands = d ? parseSvgPathToCommands(d) : generatePresetGeometry('rect', widthPt, heightPt);

    return {
      type: 'drawing',
      widthPt: Number.isNaN(widthPt) ? 100 : widthPt,
      heightPt: Number.isNaN(heightPt) ? 100 : heightPt,
      commands,
      fill: fill && fill !== 'none' ? fill : undefined,
      stroke: stroke && stroke !== 'none' ? { color: stroke, widthPt: Number.isNaN(strokeWidth) ? 1 : strokeWidth } : undefined,
    };
  }

  private parseHtmlParagraph(pNode: XmlNode): ParagraphNode {
    const style = this.parseCssStyle(pNode.attributes['style']);
    const pStyle: ParagraphStyle = {};
    const bookmarkName = pNode.attributes['id'] ?? pNode.attributes['name'];

    if (style['text-align'] === 'center' || style['text-align'] === 'right' || style['text-align'] === 'justify') {
      pStyle.alignment = style['text-align'];
    }
    if (style['page-break-before'] === 'always' || style['break-before'] === 'page') {
      pStyle.pageBreakBefore = true;
    }
    if (style['page-break-after'] === 'avoid' || style['break-after'] === 'avoid') {
      pStyle.keepNext = true;
    }
    if (style['page-break-inside'] === 'avoid' || style['break-inside'] === 'avoid') {
      pStyle.keepLines = true;
    }

    const runs: RunNode[] = [];
    for (const child of pNode.children) {
      const tag = child.nodeName.toLowerCase().replace(/^[a-zA-Z0-9]+:/, '');
      if (tag === 'span') {
        runs.push(this.parseSpanToRun(child));
      } else if (tag === 'mark') {
        const commentId = child.attributes['data-comment-id'];
        for (const mChild of child.children) {
          const mTag = mChild.nodeName.toLowerCase().replace(/^[a-zA-Z0-9]+:/, '');
          if (mTag === 'span') {
            const r = this.parseSpanToRun(mChild);
            r.commentId = commentId;
            runs.push(r);
          }
        }
        if (child.children.length === 0 && child.textContent) {
          runs.push({
            type: 'run',
            text: child.textContent,
            commentId,
          });
        }
      } else if (tag === 'a') {
        const href = child.attributes['href'];
        const title = child.attributes['title'];
        const aId = child.attributes['id'] ?? child.attributes['name'];
        let url: string | undefined;
        let anchor: string | undefined;
        if (href?.startsWith('#')) {
          anchor = href.slice(1);
        } else if (href) {
          url = href;
        }
        const hlink: HyperlinkInfo = { url, anchor, tooltip: title };

        if (child.children.length === 0 && child.textContent) {
          runs.push({
            type: 'run',
            text: child.textContent,
            style: { underline: true, color: '#0563C1' },
            hyperlink: hlink,
            bookmarkName: aId,
          });
        } else {
          for (const aChild of child.children) {
            const aTag = aChild.nodeName.toLowerCase().replace(/^[a-zA-Z0-9]+:/, '');
            if (aTag === 'span') {
              runs.push(this.parseSpanToRun(aChild, hlink, aId));
            } else if (aTag === 'img') {
              const image = this.parseHtmlImage(aChild);
              if (image) {
                runs.push({
                  type: 'run',
                  text: '',
                  image,
                  hyperlink: hlink,
                  bookmarkName: aId,
                });
              }
            } else {
              runs.push({
                type: 'run',
                text: aChild.textContent,
                style: { underline: true, color: '#0563C1' },
                hyperlink: hlink,
                bookmarkName: aId,
              });
            }
          }
        }
      } else if (tag === 'sup') {
        const cls = child.attributes['class'] ?? '';
        const aChild = child.children.find((c) => c.nodeName.toLowerCase().endsWith('a'));
        const href = aChild?.attributes['href'] ?? child.attributes['href'] ?? '';
        const fnMatch = href.match(/^#fn-(\d+)$/);
        const enMatch = href.match(/^#en-(\d+)$/);

        if (fnMatch || cls.includes('footnote')) {
          const id = fnMatch ? Number(fnMatch[1]) : 1;
          runs.push({
            type: 'run',
            text: child.textContent || `[${id}]`,
            footnoteRef: { id, kind: 'footnote' },
            style: { verticalAlign: 'superscript' },
          });
        } else if (enMatch || cls.includes('endnote')) {
          const id = enMatch ? Number(enMatch[1]) : 1;
          runs.push({
            type: 'run',
            text: child.textContent || `[${id}]`,
            footnoteRef: { id, kind: 'endnote' },
            style: { verticalAlign: 'superscript' },
          });
        } else {
          runs.push({
            type: 'run',
            text: child.textContent,
            style: { verticalAlign: 'superscript' },
          });
        }
      } else if (tag === 'img') {
        const image = this.parseHtmlImage(child);
        if (image) {
          runs.push({
            type: 'run',
            text: '',
            image,
          });
        }
      } else if (tag === 'svg') {
        const shape = this.parseSvgNode(child);
        if (shape) {
          runs.push({
            type: 'run',
            text: '',
            drawing: shape,
          });
        }
      } else if (tag === 'br') {
        const brType = child.attributes['type'] ?? child.attributes['class'];
        if (brType?.includes('page')) {
          runs.push({ type: 'run', text: '', breakType: 'page' });
        } else if (brType?.includes('column')) {
          runs.push({ type: 'run', text: '', breakType: 'column' });
        } else {
          runs.push({ type: 'run', text: '\n' });
        }
      }
    }

    if (runs.length === 0 && pNode.textContent) {
      runs.push({ type: 'run', text: pNode.textContent });
    }

    return {
      type: 'paragraph',
      style: Object.keys(pStyle).length > 0 ? pStyle : undefined,
      bookmarkName,
      children: runs,
    };
  }

  private parseSpanToRun(spanNode: XmlNode, hyperlink?: HyperlinkInfo, bookmarkName?: string): RunNode {
    const spanCss = this.parseCssStyle(spanNode.attributes['style']);
    const rStyle: TextStyle = {};

    if (spanCss['font-weight'] === 'bold') rStyle.bold = true;
    if (spanCss['font-style'] === 'italic') rStyle.italic = true;
    if (spanCss['text-decoration']?.includes('underline')) rStyle.underline = true;
    if (spanCss['text-decoration']?.includes('line-through')) rStyle.strike = true;
    if (spanCss['color']) rStyle.color = spanCss['color'];
    if (spanCss['font-family']) rStyle.fontFamily = spanCss['font-family'];

    let drawing: DrawingShapeNode | undefined;
    let image: ImageNode | undefined;
    const svgChild = spanNode.children.find((c) => c.nodeName.toLowerCase().endsWith('svg'));
    if (svgChild) {
      drawing = this.parseSvgNode(svgChild);
    }
    const imgChild = spanNode.children.find((c) => c.nodeName.toLowerCase().endsWith('img'));
    if (imgChild) {
      image = this.parseHtmlImage(imgChild);
    }

    const className = spanNode.attributes['class'] ?? '';
    let field: string | undefined;
    if (className.includes('ooxen-field-page') || spanNode.textContent.trim() === '{{PAGE}}') {
      field = 'PAGE';
    } else if (className.includes('ooxen-field-numpages') || spanNode.textContent.trim() === '{{NUMPAGES}}') {
      field = 'NUMPAGES';
    }

    let breakType: 'page' | 'column' | undefined;
    if (className.includes('ooxen-page-break') || spanCss['break-before'] === 'page' || spanCss['page-break-before'] === 'always') {
      breakType = 'page';
    } else if (className.includes('ooxen-column-break') || spanCss['break-before'] === 'column') {
      breakType = 'column';
    }

    const bm = bookmarkName ?? spanNode.attributes['id'] ?? spanNode.attributes['name'];

    return {
      type: 'run',
      text: field ? spanNode.textContent.replace(/\{\{PAGE\}\}|\{\{NUMPAGES\}\}/g, '1') || '1' : spanNode.textContent,
      style: Object.keys(rStyle).length > 0 ? rStyle : undefined,
      drawing,
      image,
      field,
      hyperlink,
      bookmarkName: bm,
      breakType,
    };
  }

  private parseHtmlTable(tableNode: XmlNode): TableNode {
    const rows: TableRowNode[] = [];
    let columnWidthsPt: number[] | undefined;
    const tableStyle: TableStyle = {};

    const css = this.parseCssStyle(tableNode.attributes['style']);
    if (css['width']) {
      if (css['width'].endsWith('%')) {
        tableStyle.widthPercent = Number.parseFloat(css['width']);
      } else if (css['width'].endsWith('pt')) {
        tableStyle.widthPt = Number.parseFloat(css['width']);
      }
    }

    if (css['margin-left'] === 'auto' && css['margin-right'] === 'auto') {
      tableStyle.alignment = 'center';
    } else if (css['margin-left'] === 'auto') {
      tableStyle.alignment = 'right';
    } else if (css['margin-right'] === 'auto') {
      tableStyle.alignment = 'left';
    }

    if (css['border-top']) tableStyle.borderTop = css['border-top'];
    if (css['border-right']) tableStyle.borderRight = css['border-right'];
    if (css['border-bottom']) tableStyle.borderBottom = css['border-bottom'];
    if (css['border-left']) tableStyle.borderLeft = css['border-left'];

    const findElements = (node: XmlNode): void => {
      for (const child of node.children) {
        const tag = child.nodeName.toLowerCase().replace(/^[a-zA-Z0-9]+:/, '');
        if (tag === 'colgroup') {
          const cols: number[] = [];
          for (const colChild of child.children) {
            const colTag = colChild.nodeName.toLowerCase().replace(/^[a-zA-Z0-9]+:/, '');
            if (colTag === 'col') {
              const colCss = this.parseCssStyle(colChild.attributes['style']);
              if (colCss['width']?.endsWith('pt')) {
                cols.push(Number.parseFloat(colCss['width']));
              }
            }
          }
          if (cols.length > 0) {
            columnWidthsPt = cols;
          }
        } else if (tag === 'tr') {
          rows.push(this.parseHtmlTableRow(child));
        } else if (tag === 'tbody' || tag === 'thead' || tag === 'tfoot') {
          findElements(child);
        }
      }
    };

    findElements(tableNode);
    this.normalizeVerticalMerges(rows);

    return {
      type: 'table',
      style: Object.keys(tableStyle).length > 0 ? tableStyle : undefined,
      columnWidthsPt,
      rows,
    };
  }

  private normalizeVerticalMerges(rows: TableRowNode[]): void {
    const pendingMerges: Map<number, { remaining: number; cell: TableCellNode }> = new Map();

    for (let r = 0; r < rows.length; r++) {
      const row = rows[r]!;
      const newCells: TableCellNode[] = [];
      let inputCellIdx = 0;
      let colIdx = 0;

      while (inputCellIdx < row.children.length || pendingMerges.size > 0) {
        const pending = pendingMerges.get(colIdx);
        if (pending && pending.remaining > 0) {
          const span = pending.cell.colSpan ?? 1;
          newCells.push({
            type: 'table-cell',
            vMerge: 'continue',
            rowSpan: 0,
            colSpan: pending.cell.colSpan,
            widthPt: pending.cell.widthPt,
            children: [],
          });
          pending.remaining--;
          if (pending.remaining <= 0) {
            for (let s = 0; s < span; s++) {
              pendingMerges.delete(colIdx + s);
            }
          }
          colIdx += span;
        } else if (inputCellIdx < row.children.length) {
          const cell = row.children[inputCellIdx]!;
          inputCellIdx++;
          const span = cell.colSpan ?? 1;
          if (cell.rowSpan && cell.rowSpan > 1) {
            cell.vMerge = 'restart';
            for (let s = 0; s < span; s++) {
              pendingMerges.set(colIdx + s, { remaining: cell.rowSpan - 1, cell });
            }
          }
          newCells.push(cell);
          colIdx += span;
        } else {
          break;
        }
      }

      row.children = newCells;
    }
  }

  private parseHtmlTableRow(trNode: XmlNode): TableRowNode {
    const cells: TableCellNode[] = [];
    const trCss = this.parseCssStyle(trNode.attributes['style']);
    let heightPt: number | undefined;
    if (trCss['height']?.endsWith('pt')) {
      heightPt = Number.parseFloat(trCss['height']);
    }

    for (const child of trNode.children) {
      const tag = child.nodeName.toLowerCase().replace(/^[a-zA-Z0-9]+:/, '');
      if (tag === 'td' || tag === 'th') {
        const colSpanAttr = child.attributes['colspan'];
        const colSpan = colSpanAttr ? Number(colSpanAttr) : undefined;
        const rowSpanAttr = child.attributes['rowspan'];
        const rowSpan = rowSpanAttr ? Number(rowSpanAttr) : undefined;

        const css = this.parseCssStyle(child.attributes['style']);
        const cellStyle: TableCellStyle = {};
        let widthPt: number | undefined;

        if (css['width']?.endsWith('pt')) {
          widthPt = Number.parseFloat(css['width']);
        }
        if (css['background-color']) cellStyle.backgroundColor = css['background-color'];
        if (css['border-top']) cellStyle.borderTop = css['border-top'];
        if (css['border-right']) cellStyle.borderRight = css['border-right'];
        if (css['border-bottom']) cellStyle.borderBottom = css['border-bottom'];
        if (css['border-left']) cellStyle.borderLeft = css['border-left'];

        if (css['vertical-align']) {
          if (css['vertical-align'] === 'middle') cellStyle.verticalAlign = 'center';
          else if (css['vertical-align'] === 'top' || css['vertical-align'] === 'bottom') {
            cellStyle.verticalAlign = css['vertical-align'];
          }
        }

        if (css['padding-top']?.endsWith('pt')) cellStyle.paddingTopPt = Number.parseFloat(css['padding-top']);
        if (css['padding-right']?.endsWith('pt')) cellStyle.paddingRightPt = Number.parseFloat(css['padding-right']);
        if (css['padding-bottom']?.endsWith('pt')) cellStyle.paddingBottomPt = Number.parseFloat(css['padding-bottom']);
        if (css['padding-left']?.endsWith('pt')) cellStyle.paddingLeftPt = Number.parseFloat(css['padding-left']);

        cells.push({
          type: 'table-cell',
          colSpan: colSpan && colSpan > 1 ? colSpan : undefined,
          rowSpan: rowSpan && rowSpan > 1 ? rowSpan : undefined,
          vMerge: rowSpan && rowSpan > 1 ? 'restart' : undefined,
          widthPt,
          style: Object.keys(cellStyle).length > 0 ? cellStyle : undefined,
          children: this.parseBlockNodes(child.children),
        });
      }
    }

    return {
      type: 'table-row',
      heightPt,
      children: cells,
    };
  }

  private parseCssStyle(styleAttr?: string): Record<string, string> {
    const result: Record<string, string> = {};
    if (!styleAttr) return result;

    const declarations = styleAttr.split(';');
    for (const decl of declarations) {
      const colon = decl.indexOf(':');
      if (colon !== -1) {
        const prop = decl.slice(0, colon).trim().toLowerCase();
        const val = decl.slice(colon + 1).trim();
        if (prop && val) {
          result[prop] = val;
        }
      }
    }

    return result;
  }
}

export const defaultOoxenWriter = new StandardOoxenWriter();

/** Convenience top-level export function */
export async function exportOoxml(document: DocumentNode): Promise<Uint8Array> {
  return defaultOoxenWriter.write(document);
}

/** Convenience top-level export function for XML-HTML */
export async function exportOoxmlFromHtml(xhtmlString: string): Promise<Uint8Array> {
  return defaultOoxenWriter.writeFromHtml(xhtmlString);
}
