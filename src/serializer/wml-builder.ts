import type {
  DocumentNode,
  DrawingShapeNode,
  HeaderFooterNode,
  ImageNode,
  ParagraphNode,
  RunNode,
  SectionNode,
  TableCellNode,
  TableNode,
  TableRowNode,
} from '../types/ast.js';
import { ptToEmu, ptToTwips } from '../types/common.js';
import type { ParagraphStyle, TableStyle, TextStyle } from '../types/style.js';

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function cleanHexColor(color?: string): string | undefined {
  if (!color) return undefined;
  return color.replace(/^#/, '').toUpperCase();
}

/**
 * Builds standard ISO/IEC 29500-1 WordprocessingML, DrawingML shapes, and picture XML strings.
 */

export interface WmlBuilder {
  buildDocumentXml(
    document: DocumentNode,
    headerFooterRelIds?: Map<HeaderFooterNode, string>,
    hyperlinkRelIds?: Map<string, string>,
  ): string;
  buildHeaderXml(header: HeaderFooterNode, hyperlinkRelIds?: Map<string, string>): string;
  buildFooterXml(footer: HeaderFooterNode, hyperlinkRelIds?: Map<string, string>): string;
  buildParagraphXml(paragraph: ParagraphNode, hyperlinkRelIds?: Map<string, string>): string;
  buildTableXml(table: TableNode, hyperlinkRelIds?: Map<string, string>): string;
}

export class StandardWmlBuilder implements WmlBuilder {
  buildDocumentXml(
    document: DocumentNode,
    headerFooterRelIds?: Map<HeaderFooterNode, string>,
    hyperlinkRelIds?: Map<string, string>,
  ): string {
    const lines: string[] = [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">',
      '  <w:body>',
    ];

    const sectionCount = document.sections.length;

    for (let s = 0; s < sectionCount; s++) {
      const section = document.sections[s]!;
      const isLastSection = s === sectionCount - 1;

      for (const block of section.children) {
        if (block.type === 'paragraph') {
          lines.push(this.serializeParagraph(block, hyperlinkRelIds));
        } else if (block.type === 'table') {
          lines.push(this.serializeTable(block, hyperlinkRelIds));
        } else if (block.type === 'drawing') {
          lines.push(this.serializeBlockDrawing(block));
        } else if (block.type === 'image') {
          lines.push(this.serializeBlockImage(block));
        }
      }

      // Add section properties
      if (isLastSection) {
        lines.push(this.serializeSectionProperties(section, '    ', headerFooterRelIds));
      } else {
        // Embed section break inside an empty paragraph if section is not the last one
        lines.push('    <w:p>');
        lines.push('      <w:pPr>');
        lines.push(this.serializeSectionProperties(section, '        ', headerFooterRelIds));
        lines.push('      </w:pPr>');
        lines.push('    </w:p>');
      }
    }

    lines.push('  </w:body>');
    lines.push('</w:document>');

    return lines.join('\n');
  }

  buildHeaderXml(header: HeaderFooterNode, hyperlinkRelIds?: Map<string, string>): string {
    const lines: string[] = [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">',
    ];

    for (const block of header.children) {
      if (block.type === 'paragraph') {
        lines.push(this.serializeParagraph(block, hyperlinkRelIds));
      } else if (block.type === 'table') {
        lines.push(this.serializeTable(block, hyperlinkRelIds));
      } else if (block.type === 'drawing') {
        lines.push(this.serializeBlockDrawing(block));
      } else if (block.type === 'image') {
        lines.push(this.serializeBlockImage(block));
      }
    }

    if (header.children.length === 0) {
      lines.push('  <w:p/>');
    }

    lines.push('</w:hdr>');
    return lines.join('\n');
  }

  buildFooterXml(footer: HeaderFooterNode, hyperlinkRelIds?: Map<string, string>): string {
    const lines: string[] = [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">',
    ];

    for (const block of footer.children) {
      if (block.type === 'paragraph') {
        lines.push(this.serializeParagraph(block, hyperlinkRelIds));
      } else if (block.type === 'table') {
        lines.push(this.serializeTable(block, hyperlinkRelIds));
      } else if (block.type === 'drawing') {
        lines.push(this.serializeBlockDrawing(block));
      } else if (block.type === 'image') {
        lines.push(this.serializeBlockImage(block));
      }
    }

    if (footer.children.length === 0) {
      lines.push('  <w:p/>');
    }

    lines.push('</w:ftr>');
    return lines.join('\n');
  }

  buildParagraphXml(paragraph: ParagraphNode, hyperlinkRelIds?: Map<string, string>): string {
    return this.serializeParagraph(paragraph, hyperlinkRelIds);
  }

  buildTableXml(table: TableNode, hyperlinkRelIds?: Map<string, string>): string {
    return this.serializeTable(table, hyperlinkRelIds);
  }

  private serializeParagraph(p: ParagraphNode, hyperlinkRelIds?: Map<string, string>): string {
    const pPr = this.serializeParagraphProperties(p.style);
    const content = this.serializeParagraphContent(p, hyperlinkRelIds);

    if (pPr.length === 0 && content.length === 0) {
      return '    <w:p/>';
    }

    return ['    <w:p>', pPr, content, '    </w:p>'].filter(Boolean).join('\n');
  }

  private serializeParagraphContent(p: ParagraphNode, hyperlinkRelIds?: Map<string, string>): string {
    const pieces: string[] = [];
    const runs = p.children;
    let i = 0;

    while (i < runs.length) {
      const currentCid = runs[i]!.commentId;
      const cGroup: RunNode[] = [];
      while (i < runs.length && runs[i]!.commentId === currentCid) {
        cGroup.push(runs[i]!);
        i++;
      }

      const inner = this.serializeRunsGroup(cGroup, hyperlinkRelIds);
      if (currentCid) {
        pieces.push(
          [
            `      <w:commentRangeStart w:id="${escapeXml(currentCid)}"/>`,
            inner,
            `      <w:commentRangeEnd w:id="${escapeXml(currentCid)}"/>`,
            '      <w:r>',
            '        <w:rPr>',
            '          <w:rStyle w:val="CommentReference"/>',
            '        </w:rPr>',
            `        <w:commentReference w:id="${escapeXml(currentCid)}"/>`,
            '      </w:r>',
          ]
            .filter(Boolean)
            .join('\n'),
        );
      } else if (inner) {
        pieces.push(inner);
      }
    }

    let content = pieces.filter(Boolean).join('\n');

    if (p.bookmarkName) {
      const bmId = Math.abs(this.hashCode(p.bookmarkName)) % 100000;
      content = [
        `      <w:bookmarkStart w:id="${bmId}" w:name="${escapeXml(p.bookmarkName)}"/>`,
        content,
        `      <w:bookmarkEnd w:id="${bmId}"/>`,
      ]
        .filter(Boolean)
        .join('\n');
    }

    return content;
  }

  private serializeRunsGroup(runs: RunNode[], hyperlinkRelIds?: Map<string, string>): string {
    const pieces: string[] = [];
    let i = 0;

    while (i < runs.length) {
      const run = runs[i]!;
      const rev = run.revision;

      if (!rev) {
        pieces.push(this.serializeHyperlinkOrPlainRun(runs, i, (nextI) => { i = nextI; }, hyperlinkRelIds));
      } else {
        const rGroup: RunNode[] = [];
        while (i < runs.length && runs[i]!.revision === rev) {
          rGroup.push(runs[i]!);
          i++;
        }

        const innerRuns = this.serializeRunsGroupWithoutRevision(rGroup, hyperlinkRelIds);
        const idAttr = rev.id ? ` w:id="${escapeXml(rev.id)}"` : ' w:id="0"';
        const authorAttr = rev.author ? ` w:author="${escapeXml(rev.author)}"` : '';
        const dateAttr = rev.date ? ` w:date="${escapeXml(rev.date)}"` : '';
        const tag = rev.type === 'insert' ? 'w:ins' : 'w:del';
        pieces.push(
          [
            `      <${tag}${idAttr}${authorAttr}${dateAttr}>`,
            innerRuns,
            `      </${tag}>`,
          ].join('\n'),
        );
      }
    }

    return pieces.filter(Boolean).join('\n');
  }

  private serializeHyperlinkOrPlainRun(
    runs: RunNode[],
    startIndex: number,
    setIndex: (nextIndex: number) => void,
    hyperlinkRelIds?: Map<string, string>,
  ): string {
    let i = startIndex;
    const run = runs[i]!;
    const hlink = run.hyperlink;

    if (!hlink) {
      setIndex(i + 1);
      return this.serializeRun(run);
    }

    const group: RunNode[] = [];
    while (i < runs.length && runs[i]!.hyperlink === hlink && runs[i]!.revision === run.revision) {
      group.push(runs[i]!);
      i++;
    }
    setIndex(i);

    const innerRuns = group.map((r) => this.serializeRun(r)).join('\n');
    const tooltipAttr = hlink.tooltip ? ` w:tooltip="${escapeXml(hlink.tooltip)}"` : '';

    if (hlink.url) {
      const relId = hyperlinkRelIds?.get(hlink.url) ?? 'rIdLink';
      return [
        `      <w:hyperlink r:id="${relId}"${tooltipAttr} w:history="1">`,
        innerRuns,
        '      </w:hyperlink>',
      ].join('\n');
    }
    if (hlink.anchor) {
      return [
        `      <w:hyperlink w:anchor="${escapeXml(hlink.anchor)}"${tooltipAttr} w:history="1">`,
        innerRuns,
        '      </w:hyperlink>',
      ].join('\n');
    }
    return innerRuns;
  }

  private serializeRunsGroupWithoutRevision(runs: RunNode[], hyperlinkRelIds?: Map<string, string>): string {
    const pieces: string[] = [];
    let i = 0;
    while (i < runs.length) {
      pieces.push(this.serializeHyperlinkOrPlainRun(runs, i, (nextI) => { i = nextI; }, hyperlinkRelIds));
    }
    return pieces.filter(Boolean).join('\n');
  }

  private hashCode(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
    }
    return hash;
  }

  private serializeParagraphProperties(style?: ParagraphStyle): string {
    if (!style) return '';
    const inner: string[] = [];

    if (style.alignment) {
      const jcVal = style.alignment === 'justify' ? 'both' : style.alignment;
      inner.push(`      <w:jc w:val="${jcVal}"/>`);
    }

    if (style.numbering) {
      inner.push(
        [
          '      <w:numPr>',
          `        <w:ilvl w:val="${style.numbering.level}"/>`,
          `        <w:numId w:val="${style.numbering.numId}"/>`,
          '      </w:numPr>',
        ].join('\n')
      );
    }

    if (style.spaceBeforePt !== undefined || style.spaceAfterPt !== undefined || style.lineSpacingPt !== undefined) {
      const attrs: string[] = [];
      if (style.spaceBeforePt !== undefined) attrs.push(`w:before="${Math.round(ptToTwips(style.spaceBeforePt))}"`);
      if (style.spaceAfterPt !== undefined) attrs.push(`w:after="${Math.round(ptToTwips(style.spaceAfterPt))}"`);
      if (style.lineSpacingPt !== undefined) attrs.push(`w:line="${Math.round(ptToTwips(style.lineSpacingPt))}"`);
      inner.push(`      <w:spacing ${attrs.join(' ')}/>`);
    }

    if (style.indentLeftPt !== undefined || style.indentRightPt !== undefined || style.firstLineIndentPt !== undefined) {
      const attrs: string[] = [];
      if (style.indentLeftPt !== undefined) attrs.push(`w:left="${Math.round(ptToTwips(style.indentLeftPt))}"`);
      if (style.indentRightPt !== undefined) attrs.push(`w:right="${Math.round(ptToTwips(style.indentRightPt))}"`);
      if (style.firstLineIndentPt !== undefined) attrs.push(`w:firstLine="${Math.round(ptToTwips(style.firstLineIndentPt))}"`);
      inner.push(`      <w:ind ${attrs.join(' ')}/>`);
    }

    if (style.pageBreakBefore) {
      inner.push('      <w:pageBreakBefore/>');
    }
    if (style.keepNext) {
      inner.push('      <w:keepNext/>');
    }
    if (style.keepLines) {
      inner.push('      <w:keepLines/>');
    }

    if (inner.length === 0) return '';
    return ['      <w:pPr>', ...inner, '      </w:pPr>'].join('\n');
  }

  private serializeRun(r: RunNode): string {
    const rPr = this.serializeRunProperties(r.style);
    const textPieces: string[] = [];

    // Split text by newlines into text and breaks
    const parts = r.text.split('\n');
    const textTag = r.revision?.type === 'delete' ? 'w:delText' : 'w:t';
    for (let i = 0; i < parts.length; i++) {
      const text = parts[i]!;
      if (text.length > 0) {
        const needsPreserve = text.startsWith(' ') || text.endsWith(' ') || text.includes('  ');
        const preserveAttr = needsPreserve ? ' xml:space="preserve"' : '';
        textPieces.push(`      <${textTag}${preserveAttr}>${escapeXml(text)}</${textTag}>`);
      }
      if (i < parts.length - 1) {
        textPieces.push('      <w:br/>');
      }
    }

    const drawingXml = r.drawing ? this.serializeDrawing(r.drawing) : '';
    const imageXml = r.image ? this.serializeImage(r.image) : '';
    const footnoteRefXml = r.footnoteRef
      ? r.footnoteRef.kind === 'footnote'
        ? `      <w:footnoteReference w:id="${r.footnoteRef.id}"/>`
        : `      <w:endnoteReference w:id="${r.footnoteRef.id}"/>`
      : '';
    const footnoteMarkXml = r.isFootnoteRefMark ? '      <w:footnoteRef/>' : '';
    const breakXml = r.breakType
      ? r.breakType === 'page'
        ? '      <w:br w:type="page"/>'
        : '      <w:br w:type="column"/>'
      : '';

    if (textPieces.length === 0 && !rPr && !drawingXml && !imageXml && !footnoteRefXml && !footnoteMarkXml && !breakXml) {
      return '';
    }

    const runXml = [
      '      <w:r>',
      rPr,
      ...textPieces,
      drawingXml,
      imageXml,
      footnoteRefXml,
      footnoteMarkXml,
      breakXml,
      '      </w:r>',
    ]
      .filter(Boolean)
      .join('\n');

    if (r.field) {
      return [
        `      <w:fldSimple w:instr="${escapeXml(r.field)}">`,
        runXml,
        '      </w:fldSimple>',
      ].join('\n');
    }

    return runXml;
  }

  private serializeImage(image: ImageNode): string {
    const cx = Math.round(ptToEmu(image.widthPt));
    const cy = Math.round(ptToEmu(image.heightPt));
    const id = image.id ?? '1';
    const name = image.name ?? 'Picture 1';
    const relId = image.relationshipId ?? 'rIdImage';
    const altText = image.altText ?? name;

    return [
      '        <w:drawing>',
      '          <wp:inline>',
      `            <wp:extent cx="${cx}" cy="${cy}"/>`,
      `            <wp:docPr id="${escapeXml(id)}" name="${escapeXml(name)}" descr="${escapeXml(altText)}"/>`,
      '            <a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">',
      '              <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">',
      '                <pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">',
      '                  <pic:nvPicPr>',
      `                    <pic:cNvPr id="0" name="${escapeXml(name)}" descr="${escapeXml(altText)}"/>`,
      '                    <pic:cNvPicPr/>',
      '                  </pic:nvPicPr>',
      '                  <pic:blipFill>',
      `                    <a:blip r:embed="${escapeXml(relId)}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/>`,
      '                    <a:stretch><a:fillRect/></a:stretch>',
      '                  </pic:blipFill>',
      '                  <pic:spPr>',
      '                    <a:xfrm>',
      '                      <a:off x="0" y="0"/>',
      `                      <a:ext cx="${cx}" cy="${cy}"/>`,
      '                    </a:xfrm>',
      '                    <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>',
      '                  </pic:spPr>',
      '                </pic:pic>',
      '              </a:graphicData>',
      '            </a:graphic>',
      '          </wp:inline>',
      '        </w:drawing>',
    ].join('\n');
  }

  private serializeBlockImage(image: ImageNode): string {
    return [
      '    <w:p>',
      '      <w:r>',
      this.serializeImage(image),
      '      </w:r>',
      '    </w:p>',
    ].join('\n');
  }

  private serializeDrawing(shape: DrawingShapeNode): string {
    const cx = Math.round(shape.widthPt * 12700);
    const cy = Math.round(shape.heightPt * 12700);
    const id = shape.id ?? '1';
    const name = shape.name ?? 'Shape 1';

    const pathW = Math.max(1, Math.round(shape.widthPt));
    const pathH = Math.max(1, Math.round(shape.heightPt));

    const pathCommandsXml: string[] = [];
    for (const cmd of shape.commands) {
      switch (cmd.type) {
        case 'moveTo':
          pathCommandsXml.push(`                        <a:moveTo><a:pt x="${Math.round(cmd.points[0] ?? 0)}" y="${Math.round(cmd.points[1] ?? 0)}"/></a:moveTo>`);
          break;
        case 'lineTo':
          pathCommandsXml.push(`                        <a:lnTo><a:pt x="${Math.round(cmd.points[0] ?? 0)}" y="${Math.round(cmd.points[1] ?? 0)}"/></a:lnTo>`);
          break;
        case 'cubicBezTo':
          pathCommandsXml.push(
            `                        <a:cubicBezTo><a:pt x="${Math.round(cmd.points[0] ?? 0)}" y="${Math.round(cmd.points[1] ?? 0)}"/><a:pt x="${Math.round(cmd.points[2] ?? 0)}" y="${Math.round(cmd.points[3] ?? 0)}"/><a:pt x="${Math.round(cmd.points[4] ?? 0)}" y="${Math.round(cmd.points[5] ?? 0)}"/></a:cubicBezTo>`
          );
          break;
        case 'quadBezTo':
          pathCommandsXml.push(
            `                        <a:quadBezTo><a:pt x="${Math.round(cmd.points[0] ?? 0)}" y="${Math.round(cmd.points[1] ?? 0)}"/><a:pt x="${Math.round(cmd.points[2] ?? 0)}" y="${Math.round(cmd.points[3] ?? 0)}"/></a:quadBezTo>`
          );
          break;
        case 'close':
          pathCommandsXml.push('                        <a:close/>');
          break;
      }
    }

    const fillXml = shape.fill ? `                      <a:solidFill><a:srgbClr val="${cleanHexColor(shape.fill)}"/></a:solidFill>` : '';
    const strokeXml = shape.stroke
      ? `                      <a:ln w="${Math.round(shape.stroke.widthPt * 12700)}"><a:solidFill><a:srgbClr val="${cleanHexColor(shape.stroke.color)}"/></a:solidFill></a:ln>`
      : '';

    return [
      '        <w:drawing>',
      '          <wp:inline>',
      `            <wp:extent cx="${cx}" cy="${cy}"/>`,
      `            <wp:docPr id="${escapeXml(id)}" name="${escapeXml(name)}"/>`,
      '            <a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">',
      '              <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">',
      '                <wps:wsp xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">',
      '                  <wps:spPr>',
      '                    <a:xfrm>',
      '                      <a:off x="0" y="0"/>',
      `                      <a:ext cx="${cx}" cy="${cy}"/>`,
      '                    </a:xfrm>',
      '                    <a:custGeom>',
      '                      <a:pathLst>',
      `                        <a:path w="${pathW}" h="${pathH}">`,
      ...pathCommandsXml,
      '                        </a:path>',
      '                      </a:pathLst>',
      '                    </a:custGeom>',
      fillXml,
      strokeXml,
      '                  </wps:spPr>',
      '                </wps:wsp>',
      '              </a:graphicData>',
      '            </a:graphic>',
      '          </wp:inline>',
      '        </w:drawing>',
    ].filter(Boolean).join('\n');
  }

  private serializeBlockDrawing(shape: DrawingShapeNode): string {
    return [
      '    <w:p>',
      '      <w:r>',
      this.serializeDrawing(shape),
      '      </w:r>',
      '    </w:p>',
    ].join('\n');
  }

  private serializeRunProperties(style?: TextStyle): string {
    if (!style) return '';
    const inner: string[] = [];

    if (style.fontFamily) {
      inner.push(`        <w:rFonts w:ascii="${escapeXml(style.fontFamily)}" w:hAnsi="${escapeXml(style.fontFamily)}"/>`);
    }
    if (style.bold) inner.push('        <w:b/>');
    if (style.italic) inner.push('        <w:i/>');
    if (style.underline) inner.push('        <w:u w:val="single"/>');
    if (style.strike) inner.push('        <w:strike/>');
    if (style.fontSizePt) {
      inner.push(`        <w:sz w:val="${Math.round(style.fontSizePt * 2)}"/>`);
    }
    if (style.color) {
      inner.push(`        <w:color w:val="${cleanHexColor(style.color)}"/>`);
    }
    if (style.backgroundColor) {
      inner.push(`        <w:shd w:fill="${cleanHexColor(style.backgroundColor)}"/>`);
    }
    if (style.verticalAlign) {
      inner.push(`        <w:vertAlign w:val="${style.verticalAlign}"/>`);
    }

    if (inner.length === 0) return '';
    return ['        <w:rPr>', ...inner, '        </w:rPr>'].join('\n');
  }

  private serializeTable(table: TableNode, hyperlinkRelIds?: Map<string, string>): string {
    const tblPr = this.serializeTableProperties(table.style);
    let tblGrid = '';
    if (table.columnWidthsPt && table.columnWidthsPt.length > 0) {
      const cols = table.columnWidthsPt
        .map((w) => `        <w:gridCol w:w="${Math.round(ptToTwips(w))}"/>`)
        .join('\n');
      tblGrid = `      <w:tblGrid>\n${cols}\n      </w:tblGrid>`;
    }

    const rows = table.rows.map((row) => this.serializeTableRow(row, hyperlinkRelIds)).join('\n');
    return ['    <w:tbl>', tblPr, tblGrid, rows, '    </w:tbl>'].filter(Boolean).join('\n');
  }

  private serializeTableProperties(style?: TableStyle): string {
    if (!style || Object.keys(style).length === 0) {
      return '      <w:tblPr/>';
    }

    const inner: string[] = [];

    if (style.alignment) {
      inner.push(`        <w:jc w:val="${style.alignment}"/>`);
    }

    if (style.widthPercent !== undefined) {
      inner.push(`        <w:tblW w:w="${Math.round(style.widthPercent * 50)}" w:type="pct"/>`);
    } else if (style.widthPt !== undefined) {
      inner.push(`        <w:tblW w:w="${Math.round(ptToTwips(style.widthPt))}" w:type="dxa"/>`);
    }

    // Borders
    const borders: string[] = [];
    if (style.borderTop) borders.push(this.formatBorderElement('top', style.borderTop));
    if (style.borderLeft) borders.push(this.formatBorderElement('left', style.borderLeft));
    if (style.borderBottom) borders.push(this.formatBorderElement('bottom', style.borderBottom));
    if (style.borderRight) borders.push(this.formatBorderElement('right', style.borderRight));
    if (style.borderInsideH) borders.push(this.formatBorderElement('insideH', style.borderInsideH));
    if (style.borderInsideV) borders.push(this.formatBorderElement('insideV', style.borderInsideV));

    if (borders.length > 0) {
      inner.push('        <w:tblBorders>', ...borders, '        </w:tblBorders>');
    }

    // Cell margins
    const hasMargins =
      style.cellMarginTopPt !== undefined ||
      style.cellMarginRightPt !== undefined ||
      style.cellMarginBottomPt !== undefined ||
      style.cellMarginLeftPt !== undefined;

    if (hasMargins) {
      const margins: string[] = [];
      if (style.cellMarginTopPt !== undefined) {
        margins.push(`          <w:top w:w="${Math.round(ptToTwips(style.cellMarginTopPt))}" w:type="dxa"/>`);
      }
      if (style.cellMarginLeftPt !== undefined) {
        margins.push(`          <w:left w:w="${Math.round(ptToTwips(style.cellMarginLeftPt))}" w:type="dxa"/>`);
      }
      if (style.cellMarginBottomPt !== undefined) {
        margins.push(`          <w:bottom w:w="${Math.round(ptToTwips(style.cellMarginBottomPt))}" w:type="dxa"/>`);
      }
      if (style.cellMarginRightPt !== undefined) {
        margins.push(`          <w:right w:w="${Math.round(ptToTwips(style.cellMarginRightPt))}" w:type="dxa"/>`);
      }
      inner.push('        <w:tblCellMar>', ...margins, '        </w:tblCellMar>');
    }

    if (inner.length === 0) {
      return '      <w:tblPr/>';
    }

    return ['      <w:tblPr>', ...inner, '      </w:tblPr>'].join('\n');
  }

  private formatBorderElement(tag: string, borderDef: string, indent: string = '          '): string {
    if (borderDef === 'none') {
      return `${indent}<w:${tag} w:val="none"/>`;
    }
    const parts = borderDef.trim().split(/\s+/);
    const borderType = parts[0] === 'solid' ? 'single' : (parts[0] || 'single');
    const borderCol = parts[1] ? cleanHexColor(parts[1]) : 'auto';
    return `${indent}<w:${tag} w:val="${borderType}" w:sz="4" w:space="0" w:color="${borderCol}"/>`;
  }

  private serializeTableRow(row: TableRowNode, hyperlinkRelIds?: Map<string, string>): string {
    const trPr = this.serializeTableRowProperties(row);
    const cells = row.children.map((cell) => this.serializeTableCell(cell, hyperlinkRelIds)).join('\n');
    return ['      <w:tr>', trPr, cells, '      </w:tr>'].filter(Boolean).join('\n');
  }

  private serializeTableRowProperties(row: TableRowNode): string {
    const inner: string[] = [];

    if (row.heightPt !== undefined) {
      inner.push(`          <w:trHeight w:val="${Math.round(ptToTwips(row.heightPt))}"/>`);
    }
    if (row.cantSplit) {
      inner.push('          <w:cantSplit/>');
    }
    if (row.tblHeader) {
      inner.push('          <w:tblHeader/>');
    }

    if (inner.length === 0) return '';
    return ['        <w:trPr>', ...inner, '        </w:trPr>'].join('\n');
  }

  private serializeTableCell(cell: TableCellNode, hyperlinkRelIds?: Map<string, string>): string {
    const tcPr = this.serializeTableCellProperties(cell);
    const content = cell.children
      .map((child) => {
        if (child.type === 'paragraph') return this.serializeParagraph(child, hyperlinkRelIds);
        if (child.type === 'table') return this.serializeTable(child, hyperlinkRelIds);
        if (child.type === 'image') return this.serializeBlockImage(child);
        return this.serializeBlockDrawing(child);
      })
      .join('\n');

    return ['        <w:tc>', tcPr, content.length > 0 ? content : '          <w:p/>', '        </w:tc>']
      .filter(Boolean)
      .join('\n');
  }

  private serializeTableCellProperties(cell: TableCellNode): string {
    const inner: string[] = [];
    const { style, colSpan, widthPt } = cell;

    if (widthPt !== undefined) {
      inner.push(`            <w:tcW w:w="${Math.round(ptToTwips(widthPt))}" w:type="dxa"/>`);
    }
    if (colSpan && colSpan > 1) {
      inner.push(`            <w:gridSpan w:val="${colSpan}"/>`);
    }
    if (cell.vMerge === 'restart' || (cell.rowSpan !== undefined && cell.rowSpan > 1)) {
      inner.push('            <w:vMerge w:val="restart"/>');
    } else if (cell.vMerge === 'continue' || cell.rowSpan === 0) {
      inner.push('            <w:vMerge/>');
    }
    if (style?.backgroundColor) {
      inner.push(`            <w:shd w:fill="${cleanHexColor(style.backgroundColor)}"/>`);
    }
    if (style?.verticalAlign) {
      inner.push(`            <w:vAlign w:val="${style.verticalAlign}"/>`);
    }

    // Cell borders
    const borders: string[] = [];
    if (style?.borderTop) borders.push(this.formatBorderElement('top', style.borderTop, '              '));
    if (style?.borderLeft) borders.push(this.formatBorderElement('left', style.borderLeft, '              '));
    if (style?.borderBottom) borders.push(this.formatBorderElement('bottom', style.borderBottom, '              '));
    if (style?.borderRight) borders.push(this.formatBorderElement('right', style.borderRight, '              '));
    if (borders.length > 0) {
      inner.push('            <w:tcBorders>', ...borders, '            </w:tcBorders>');
    }

    // Cell margins (padding)
    const hasPadding =
      style?.paddingTopPt !== undefined ||
      style?.paddingRightPt !== undefined ||
      style?.paddingBottomPt !== undefined ||
      style?.paddingLeftPt !== undefined;

    if (hasPadding) {
      const margins: string[] = [];
      if (style.paddingTopPt !== undefined) {
        margins.push(`              <w:top w:w="${Math.round(ptToTwips(style.paddingTopPt))}" w:type="dxa"/>`);
      }
      if (style.paddingLeftPt !== undefined) {
        margins.push(`              <w:left w:w="${Math.round(ptToTwips(style.paddingLeftPt))}" w:type="dxa"/>`);
      }
      if (style.paddingBottomPt !== undefined) {
        margins.push(`              <w:bottom w:w="${Math.round(ptToTwips(style.paddingBottomPt))}" w:type="dxa"/>`);
      }
      if (style.paddingRightPt !== undefined) {
        margins.push(`              <w:right w:w="${Math.round(ptToTwips(style.paddingRightPt))}" w:type="dxa"/>`);
      }
      inner.push('            <w:tcMar>', ...margins, '            </w:tcMar>');
    }

    if (inner.length === 0) return '';
    return ['          <w:tcPr>', ...inner, '          </w:tcPr>'].join('\n');
  }

  private serializeSectionProperties(
    section: SectionNode,
    indent: string = '    ',
    headerFooterRelIds?: Map<HeaderFooterNode, string>,
  ): string {
    const { pageSize, margins } = section.properties;
    const wTwips = Math.round(ptToTwips(pageSize.width));
    const hTwips = Math.round(ptToTwips(pageSize.height));

    const topTwips = Math.round(ptToTwips(margins.top));
    const rightTwips = Math.round(ptToTwips(margins.right));
    const bottomTwips = Math.round(ptToTwips(margins.bottom));
    const leftTwips = Math.round(ptToTwips(margins.left));
    const headerTwips = Math.round(ptToTwips(section.properties.headerDistancePt ?? 36));
    const footerTwips = Math.round(ptToTwips(section.properties.footerDistancePt ?? 36));

    const refs: string[] = [];

    // Header references
    if (section.headers?.default && headerFooterRelIds?.has(section.headers.default)) {
      refs.push(`${indent}  <w:headerReference w:type="default" r:id="${headerFooterRelIds.get(section.headers.default)}"/>`);
    }
    if (section.headers?.first && headerFooterRelIds?.has(section.headers.first)) {
      refs.push(`${indent}  <w:headerReference w:type="first" r:id="${headerFooterRelIds.get(section.headers.first)}"/>`);
    }
    if (section.headers?.even && headerFooterRelIds?.has(section.headers.even)) {
      refs.push(`${indent}  <w:headerReference w:type="even" r:id="${headerFooterRelIds.get(section.headers.even)}"/>`);
    }

    // Footer references
    if (section.footers?.default && headerFooterRelIds?.has(section.footers.default)) {
      refs.push(`${indent}  <w:footerReference w:type="default" r:id="${headerFooterRelIds.get(section.footers.default)}"/>`);
    }
    if (section.footers?.first && headerFooterRelIds?.has(section.footers.first)) {
      refs.push(`${indent}  <w:footerReference w:type="first" r:id="${headerFooterRelIds.get(section.footers.first)}"/>`);
    }
    if (section.footers?.even && headerFooterRelIds?.has(section.footers.even)) {
      refs.push(`${indent}  <w:footerReference w:type="even" r:id="${headerFooterRelIds.get(section.footers.even)}"/>`);
    }

    let colsXml = '';
    const cols = section.properties.columns;
    if (cols && cols.count > 1) {
      const spaceTwips = Math.round(ptToTwips(cols.spacePt ?? 36));
      const eqAttr = cols.equalWidth === false ? ' w:equalWidth="0"' : '';
      const sepAttr = cols.separator ? ' w:sep="1"' : '';

      if (cols.columns && cols.columns.length > 0) {
        const colElements = cols.columns
          .map((c) => {
            const wT = Math.round(ptToTwips(c.widthPt));
            const sT = c.spacePt !== undefined ? ` w:space="${Math.round(ptToTwips(c.spacePt))}"` : '';
            return `${indent}    <w:col w:w="${wT}"${sT}/>`;
          })
          .join('\n');
        colsXml = `${indent}  <w:cols w:num="${cols.count}" w:space="${spaceTwips}"${eqAttr}${sepAttr}>\n${colElements}\n${indent}  </w:cols>`;
      } else {
        colsXml = `${indent}  <w:cols w:num="${cols.count}" w:space="${spaceTwips}"${eqAttr}${sepAttr}/>`;
      }
    } else {
      colsXml = `${indent}  <w:cols w:space="720"/>`;
    }

    const titlePgXml = section.properties.titlePg || section.headers?.first || section.footers?.first
      ? `${indent}  <w:titlePg/>`
      : '';

    return [
      `${indent}<w:sectPr>`,
      ...refs,
      `${indent}  <w:pgSz w:w="${wTwips}" w:h="${hTwips}"/>`,
      `${indent}  <w:pgMar w:top="${topTwips}" w:right="${rightTwips}" w:bottom="${bottomTwips}" w:left="${leftTwips}" w:header="${headerTwips}" w:footer="${footerTwips}"/>`,
      colsXml,
      titlePgXml,
      `${indent}</w:sectPr>`,
    ].filter(Boolean).join('\n');
  }
}

export const defaultWmlBuilder = new StandardWmlBuilder();
