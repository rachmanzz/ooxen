import { defaultXmlAdapter, type XmlAdapter, type XmlNode } from '../parser/xml-adapter.js';
import type { BlockNode, DocumentNode, ParagraphNode, RunNode, SectionNode, TableCellNode, TableNode, TableRowNode } from '../types/ast.js';
import type { ParagraphStyle, TableCellStyle, TextStyle } from '../types/style.js';
import { defaultPackageBuilder, type PackageBuilder } from './package-builder.js';
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
    const documentXml = this.wmlBuilder.buildDocumentXml(document);
    const pkg = this.packageBuilder.assemblePackage(documentXml);
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
      sections.push({
        type: 'section',
        properties: {
          pageSize: { width: 612, height: 792 },
          margins: { top: 72, right: 72, bottom: 72, left: 72 },
        },
        children: this.parseBlockNodes(rootNode.children),
      });
    } else {
      for (const sNode of sectionNodes) {
        sections.push({
          type: 'section',
          properties: {
            pageSize: { width: 612, height: 792 },
            margins: { top: 72, right: 72, bottom: 72, left: 72 },
          },
          children: this.parseBlockNodes(sNode.children),
        });
      }
    }

    return {
      type: 'document',
      sections,
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
      }
    }

    return blocks;
  }

  private parseHtmlParagraph(pNode: XmlNode): ParagraphNode {
    const style = this.parseCssStyle(pNode.attributes['style']);
    const pStyle: ParagraphStyle = {};

    if (style['text-align'] === 'center' || style['text-align'] === 'right' || style['text-align'] === 'justify') {
      pStyle.alignment = style['text-align'];
    }

    const runs: RunNode[] = [];
    for (const child of pNode.children) {
      const tag = child.nodeName.toLowerCase().replace(/^[a-zA-Z0-9]+:/, '');
      if (tag === 'span') {
        const spanCss = this.parseCssStyle(child.attributes['style']);
        const rStyle: TextStyle = {};

        if (spanCss['font-weight'] === 'bold') rStyle.bold = true;
        if (spanCss['font-style'] === 'italic') rStyle.italic = true;
        if (spanCss['text-decoration']?.includes('underline')) rStyle.underline = true;
        if (spanCss['text-decoration']?.includes('line-through')) rStyle.strike = true;
        if (spanCss['color']) rStyle.color = spanCss['color'];
        if (spanCss['font-family']) rStyle.fontFamily = spanCss['font-family'];

        runs.push({
          type: 'run',
          text: child.textContent,
          style: Object.keys(rStyle).length > 0 ? rStyle : undefined,
        });
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
      children: runs,
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
