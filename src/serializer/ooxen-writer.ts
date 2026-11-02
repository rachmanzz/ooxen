import { KNOWN_RELATIONSHIPS, type OpcRelationship } from '../opc/relationships.js';
import { guessMimeType } from '../parser/dml/image-parser.js';
import { generatePresetGeometry, parseSvgPathToCommands } from '../parser/dml/shape-parser.js';
import { defaultXmlAdapter, type XmlAdapter, type XmlNode } from '../parser/xml-adapter.js';
import type {
  BlockNode,
  DocumentNode,
  DrawingShapeNode,
  HeaderFooterNode,
  HyperlinkInfo,
  ImageNode,
  ParagraphNode,
  RunNode,
  SectionNode,
  TableCellNode,
  TableNode,
  TableRowNode,
} from '../types/ast.js';
import { base64ToUint8Array } from '../types/common.js';
import type { ParagraphStyle, TableCellStyle, TextStyle } from '../types/style.js';
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
    );
    return pkg.serialize();
  }

  async writeFromHtml(xhtmlString: string): Promise<Uint8Array> {
    const rootNode = this.xmlAdapter.parse(xhtmlString);
    const doc = this.parseHtmlToAst(rootNode);
    return this.write(doc);
  }

  private parseHtmlToAst(rootNode: XmlNode): DocumentNode {
    const sections: SectionNode[] = [];
    const sectionNodes = rootNode.children.filter((c) => c.nodeName.toLowerCase().endsWith('section'));

    if (sectionNodes.length === 0) {
      // Fallback: entire root is one section
      sections.push(this.parseSectionFromHtmlNodes(rootNode.children));
    } else {
      for (const sNode of sectionNodes) {
        sections.push(this.parseSectionFromHtmlNodes(sNode.children));
      }
    }

    return {
      type: 'document',
      sections,
    };
  }

  private parseSectionFromHtmlNodes(nodes: XmlNode[]): SectionNode {
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
      } else {
        bodyNodes.push(node);
      }
    }

    return {
      type: 'section',
      properties: {
        pageSize: { width: 612, height: 792 },
        margins: { top: 72, right: 72, bottom: 72, left: 72 },
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

    const runs: RunNode[] = [];
    for (const child of pNode.children) {
      const tag = child.nodeName.toLowerCase().replace(/^[a-zA-Z0-9]+:/, '');
      if (tag === 'span') {
        runs.push(this.parseSpanToRun(child));
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
        runs.push({ type: 'run', text: '\n' });
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
    };
  }

  private parseHtmlTable(tableNode: XmlNode): TableNode {
    const rows: TableRowNode[] = [];

    const findRows = (node: XmlNode): void => {
      for (const child of node.children) {
        const tag = child.nodeName.toLowerCase().replace(/^[a-zA-Z0-9]+:/, '');
        if (tag === 'tr') {
          rows.push(this.parseHtmlTableRow(child));
        } else if (tag === 'tbody' || tag === 'thead' || tag === 'tfoot') {
          findRows(child);
        }
      }
    };

    findRows(tableNode);

    return {
      type: 'table',
      rows,
    };
  }

  private parseHtmlTableRow(trNode: XmlNode): TableRowNode {
    const cells: TableCellNode[] = [];

    for (const child of trNode.children) {
      const tag = child.nodeName.toLowerCase().replace(/^[a-zA-Z0-9]+:/, '');
      if (tag === 'td' || tag === 'th') {
        const colSpanAttr = child.attributes['colspan'];
        const colSpan = colSpanAttr ? Number(colSpanAttr) : undefined;
        const css = this.parseCssStyle(child.attributes['style']);
        const cellStyle: TableCellStyle = {};

        if (css['background-color']) cellStyle.backgroundColor = css['background-color'];

        cells.push({
          type: 'table-cell',
          colSpan: colSpan && colSpan > 1 ? colSpan : undefined,
          style: Object.keys(cellStyle).length > 0 ? cellStyle : undefined,
          children: this.parseBlockNodes(child.children),
        });
      }
    }

    return {
      type: 'table-row',
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
