import type { DocumentNode, DrawingShapeNode, ParagraphNode, RunNode, SectionNode, TableCellNode, TableNode, TableRowNode } from '../types/ast.js';
import { ptToTwips } from '../types/common.js';
import type { ParagraphStyle, TableCellStyle, TextStyle } from '../types/style.js';

function escapeXml(text: string): string {
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
 * Builds standard ISO/IEC 29500-1 WordprocessingML and DrawingML XML strings.
 */

export interface WmlBuilder {
  buildDocumentXml(document: DocumentNode): string;
}

export class StandardWmlBuilder implements WmlBuilder {
  buildDocumentXml(document: DocumentNode): string {
    const lines: string[] = [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">',
      '  <w:body>',
    ];

    const sectionCount = document.sections.length;

    for (let s = 0; s < sectionCount; s++) {
      const section = document.sections[s]!;
      const isLastSection = s === sectionCount - 1;

      for (const block of section.children) {
        if (block.type === 'paragraph') {
          lines.push(this.serializeParagraph(block));
        } else if (block.type === 'table') {
          lines.push(this.serializeTable(block));
        } else if (block.type === 'drawing') {
          lines.push(this.serializeBlockDrawing(block));
        }
      }

      // Add section properties
      if (isLastSection) {
        lines.push(this.serializeSectionProperties(section));
      } else {
        // Embed section break inside an empty paragraph if section is not the last one
        lines.push('    <w:p>');
        lines.push('      <w:pPr>');
        lines.push(this.serializeSectionProperties(section, '        '));
        lines.push('      </w:pPr>');
        lines.push('    </w:p>');
      }
    }

    lines.push('  </w:body>');
    lines.push('</w:document>');

    return lines.join('\n');
  }

  private serializeParagraph(p: ParagraphNode): string {
    const pPr = this.serializeParagraphProperties(p.style);
    const runs = p.children.map((r) => this.serializeRun(r)).join('\n');

    if (pPr.length === 0 && runs.length === 0) {
      return '    <w:p/>';
    }

    return ['    <w:p>', pPr, runs, '    </w:p>'].filter(Boolean).join('\n');
  }

  private serializeParagraphProperties(style?: ParagraphStyle): string {
    if (!style) return '';
    const inner: string[] = [];

    if (style.alignment) {
      const jcVal = style.alignment === 'justify' ? 'both' : style.alignment;
      inner.push(`      <w:jc w:val="${jcVal}"/>`);
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

    if (inner.length === 0) return '';
    return ['      <w:pPr>', ...inner, '      </w:pPr>'].join('\n');
  }

  private serializeRun(r: RunNode): string {
    const rPr = this.serializeRunProperties(r.style);
    const textPieces: string[] = [];

    // Split text by newlines into text and breaks
    const parts = r.text.split('\n');
    for (let i = 0; i < parts.length; i++) {
      const text = parts[i]!;
      if (text.length > 0) {
        const needsPreserve = text.startsWith(' ') || text.endsWith(' ') || text.includes('  ');
        const preserveAttr = needsPreserve ? ' xml:space="preserve"' : '';
        textPieces.push(`      <w:t${preserveAttr}>${escapeXml(text)}</w:t>`);
      }
      if (i < parts.length - 1) {
        textPieces.push('      <w:br/>');
      }
    }

    const drawingXml = r.drawing ? this.serializeDrawing(r.drawing) : '';

    if (textPieces.length === 0 && !rPr && !drawingXml) {
      return '';
    }

    return ['      <w:r>', rPr, ...textPieces, drawingXml, '      </w:r>'].filter(Boolean).join('\n');
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

    if (inner.length === 0) return '';
    return ['        <w:rPr>', ...inner, '        </w:rPr>'].join('\n');
  }

  private serializeTable(table: TableNode): string {
    const rows = table.rows.map((row) => this.serializeTableRow(row)).join('\n');
    return ['    <w:tbl>', '      <w:tblPr/>', rows, '    </w:tbl>'].join('\n');
  }

  private serializeTableRow(row: TableRowNode): string {
    const cells = row.children.map((cell) => this.serializeTableCell(cell)).join('\n');
    return ['      <w:tr>', cells, '      </w:tr>'].join('\n');
  }

  private serializeTableCell(cell: TableCellNode): string {
    const tcPr = this.serializeTableCellProperties(cell.style, cell.colSpan);
    const content = cell.children
      .map((child) => {
        if (child.type === 'paragraph') return this.serializeParagraph(child);
        if (child.type === 'table') return this.serializeTable(child);
        return this.serializeBlockDrawing(child);
      })
      .join('\n');

    return ['        <w:tc>', tcPr, content.length > 0 ? content : '          <w:p/>', '        </w:tc>']
      .filter(Boolean)
      .join('\n');
  }

  private serializeTableCellProperties(style?: TableCellStyle, colSpan?: number): string {
    const inner: string[] = [];

    if (colSpan && colSpan > 1) {
      inner.push(`            <w:gridSpan w:val="${colSpan}"/>`);
    }
    if (style?.backgroundColor) {
      inner.push(`            <w:shd w:fill="${cleanHexColor(style.backgroundColor)}"/>`);
    }

    if (inner.length === 0) return '';
    return ['          <w:tcPr>', ...inner, '          </w:tcPr>'].join('\n');
  }

  private serializeSectionProperties(section: SectionNode, indent: string = '    '): string {
    const { pageSize, margins } = section.properties;
    const wTwips = Math.round(ptToTwips(pageSize.width));
    const hTwips = Math.round(ptToTwips(pageSize.height));

    const topTwips = Math.round(ptToTwips(margins.top));
    const rightTwips = Math.round(ptToTwips(margins.right));
    const bottomTwips = Math.round(ptToTwips(margins.bottom));
    const leftTwips = Math.round(ptToTwips(margins.left));

    return [
      `${indent}<w:sectPr>`,
      `${indent}  <w:pgSz w:w="${wTwips}" w:h="${hTwips}"/>`,
      `${indent}  <w:pgMar w:top="${topTwips}" w:right="${rightTwips}" w:bottom="${bottomTwips}" w:left="${leftTwips}"/>`,
      `${indent}</w:sectPr>`,
    ].join('\n');
  }
}

export const defaultWmlBuilder = new StandardWmlBuilder();
