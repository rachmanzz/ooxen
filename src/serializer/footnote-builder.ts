import type { FootnoteNode } from '../types/ast.js';
import { defaultWmlBuilder, type WmlBuilder } from './wml-builder.js';

/**
 * Builds ISO/IEC 29500-1 WordprocessingML Footnotes (word/footnotes.xml) and Endnotes (word/endnotes.xml).
 */
export interface FootnoteBuilder {
  buildFootnotesXml(footnotes: FootnoteNode[], hyperlinkRelIds?: Map<string, string>): string;
  buildEndnotesXml(endnotes: FootnoteNode[], hyperlinkRelIds?: Map<string, string>): string;
}

export class StandardFootnoteBuilder implements FootnoteBuilder {
  private wmlBuilder: WmlBuilder;

  constructor(wmlBuilder: WmlBuilder = defaultWmlBuilder) {
    this.wmlBuilder = wmlBuilder;
  }

  buildFootnotesXml(footnotes: FootnoteNode[], hyperlinkRelIds?: Map<string, string>): string {
    const lines: string[] = [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
    ];

    const hasSeparator = footnotes.some((fn) => fn.typeCategory === 'separator' || fn.id === -1);
    const hasContinuation = footnotes.some((fn) => fn.typeCategory === 'continuationSeparator' || fn.id === 0);

    if (!hasSeparator) {
      lines.push('  <w:footnote w:type="separator" w:id="-1">');
      lines.push('    <w:p><w:r><w:separator/></w:r></w:p>');
      lines.push('  </w:footnote>');
    }

    if (!hasContinuation) {
      lines.push('  <w:footnote w:type="continuationSeparator" w:id="0">');
      lines.push('    <w:p><w:r><w:continuationSeparator/></w:r></w:p>');
      lines.push('  </w:footnote>');
    }

    for (const fn of footnotes) {
      if (fn.id === -1 || fn.id === 0) continue;
      const typeAttr = fn.typeCategory && fn.typeCategory !== 'normal' ? ` w:type="${fn.typeCategory}"` : '';
      lines.push(`  <w:footnote w:id="${fn.id}"${typeAttr}>`);
      for (const block of fn.children) {
        if (block.type === 'paragraph') {
          lines.push(this.wmlBuilder.buildParagraphXml(block, hyperlinkRelIds));
        } else if (block.type === 'table') {
          lines.push(this.wmlBuilder.buildTableXml(block, hyperlinkRelIds));
        }
      }
      lines.push('  </w:footnote>');
    }

    lines.push('</w:footnotes>');
    return lines.join('\n');
  }

  buildEndnotesXml(endnotes: FootnoteNode[], hyperlinkRelIds?: Map<string, string>): string {
    const lines: string[] = [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<w:endnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
    ];

    const hasSeparator = endnotes.some((en) => en.typeCategory === 'separator' || en.id === -1);
    const hasContinuation = endnotes.some((en) => en.typeCategory === 'continuationSeparator' || en.id === 0);

    if (!hasSeparator) {
      lines.push('  <w:endnote w:type="separator" w:id="-1">');
      lines.push('    <w:p><w:r><w:separator/></w:r></w:p>');
      lines.push('  </w:endnote>');
    }

    if (!hasContinuation) {
      lines.push('  <w:endnote w:type="continuationSeparator" w:id="0">');
      lines.push('    <w:p><w:r><w:continuationSeparator/></w:r></w:p>');
      lines.push('  </w:endnote>');
    }

    for (const en of endnotes) {
      if (en.id === -1 || en.id === 0) continue;
      const typeAttr = en.typeCategory && en.typeCategory !== 'normal' ? ` w:type="${en.typeCategory}"` : '';
      lines.push(`  <w:endnote w:id="${en.id}"${typeAttr}>`);
      for (const block of en.children) {
        if (block.type === 'paragraph') {
          lines.push(this.wmlBuilder.buildParagraphXml(block, hyperlinkRelIds));
        } else if (block.type === 'table') {
          lines.push(this.wmlBuilder.buildTableXml(block, hyperlinkRelIds));
        }
      }
      lines.push('  </w:endnote>');
    }

    lines.push('</w:endnotes>');
    return lines.join('\n');
  }
}

export const defaultFootnoteBuilder = new StandardFootnoteBuilder();
