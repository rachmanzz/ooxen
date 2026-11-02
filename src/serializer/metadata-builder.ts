import type { DocumentMetadata } from '../types/ast.js';

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export interface DocumentStats {
  pages?: number;
  words?: number;
  characters?: number;
  paragraphs?: number;
  lines?: number;
}

/**
 * Builds ISO/IEC 29500-2 Core Properties (docProps/core.xml) and
 * ISO/IEC 29500-1 Extended Properties (docProps/app.xml) XML strings.
 */
export interface MetadataBuilder {
  buildCorePropertiesXml(metadata: DocumentMetadata): string;
  buildAppPropertiesXml(metadata: DocumentMetadata, stats?: DocumentStats): string;
}

export class StandardMetadataBuilder implements MetadataBuilder {
  buildCorePropertiesXml(metadata: DocumentMetadata): string {
    const lines: string[] = [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
    ];

    if (metadata.title) {
      lines.push(`  <dc:title>${escapeXml(metadata.title)}</dc:title>`);
    }
    if (metadata.subject) {
      lines.push(`  <dc:subject>${escapeXml(metadata.subject)}</dc:subject>`);
    }
    if (metadata.creator) {
      lines.push(`  <dc:creator>${escapeXml(metadata.creator)}</dc:creator>`);
    }
    if (metadata.keywords && metadata.keywords.length > 0) {
      lines.push(`  <cp:keywords>${escapeXml(metadata.keywords.join(', '))}</cp:keywords>`);
    }
    if (metadata.description) {
      lines.push(`  <dc:description>${escapeXml(metadata.description)}</dc:description>`);
    }
    if (metadata.lastModifiedBy) {
      lines.push(`  <cp:lastModifiedBy>${escapeXml(metadata.lastModifiedBy)}</cp:lastModifiedBy>`);
    }
    if (metadata.revision !== undefined) {
      lines.push(`  <cp:revision>${escapeXml(String(metadata.revision))}</cp:revision>`);
    }
    if (metadata.created) {
      lines.push(`  <dcterms:created xsi:type="dcterms:W3CDTF">${escapeXml(metadata.created)}</dcterms:created>`);
    }
    if (metadata.modified) {
      lines.push(`  <dcterms:modified xsi:type="dcterms:W3CDTF">${escapeXml(metadata.modified)}</dcterms:modified>`);
    }

    lines.push('</cp:coreProperties>');
    return lines.join('\n');
  }

  buildAppPropertiesXml(metadata: DocumentMetadata, stats?: DocumentStats): string {
    const pages = stats?.pages ?? metadata.pages ?? 1;
    const words = stats?.words ?? metadata.words ?? 0;
    const characters = stats?.characters ?? metadata.characters ?? 0;
    const paragraphs = stats?.paragraphs ?? metadata.paragraphs ?? 1;
    const linesCount = stats?.lines ?? metadata.lines ?? 1;
    const app = metadata.application || 'Ooxen';
    const company = metadata.company || '';

    const lines: string[] = [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">',
      '  <Template>Normal.dotm</Template>',
      '  <TotalTime>0</TotalTime>',
      `  <Pages>${pages}</Pages>`,
      `  <Words>${words}</Words>`,
      `  <Characters>${characters}</Characters>`,
      `  <Application>${escapeXml(app)}</Application>`,
      `  <Lines>${linesCount}</Lines>`,
      `  <Paragraphs>${paragraphs}</Paragraphs>`,
      `  <Company>${escapeXml(company)}</Company>`,
      '  <AppVersion>1.0000</AppVersion>',
      '</Properties>',
    ];

    return lines.join('\n');
  }
}

export const defaultMetadataBuilder = new StandardMetadataBuilder();
