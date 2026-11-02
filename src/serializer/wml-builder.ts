import type { DocumentNode, ParagraphNode, RunNode, SectionNode, TableCellNode, TableNode, TableRowNode } from '../types/ast.js';
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
 * Builds standard ISO/IEC 29500-1 WordprocessingML XML strings.
 */

export interface WmlBuilder {
  buildDocumentXml(document: DocumentNode): string;
}

export class StandardWmlBuilder implements WmlBuilder {
  buildDocumentXml(document: DocumentNode): string {
    const lines: string[] = [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
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

    if (textPieces.length === 0 && !rPr) {
      return '';
    }

    return ['      <w:r>', rPr, ...textPieces, '      </w:r>'].filter(Boolean).join('\n');
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
      .map((child) => (child.type === 'paragraph' ? this.serializeParagraph(child) : this.serializeTable(child)))
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
