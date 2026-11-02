import { KNOWN_RELATIONSHIPS } from '../../opc/relationships.js';
import type { OpcPackage } from '../../opc/package.js';
import type { DocumentMetadata } from '../../types/ast.js';
import { defaultXmlAdapter, type XmlAdapter } from '../xml-adapter.js';

const textDecoder = new TextDecoder();

/**
 * Parses ISO/IEC 29500-2 Dublin Core & OpenXML Core Properties (docProps/core.xml).
 */
export function parseCoreProperties(
  xmlString: string,
  adapter: XmlAdapter = defaultXmlAdapter,
): DocumentMetadata {
  const root = adapter.parse(xmlString);
  const metadata: DocumentMetadata = {};

  for (const child of root.children) {
    const localName = child.nodeName.replace(/^[a-zA-Z0-9]+:/, '').toLowerCase();
    const text = child.textContent?.trim();
    if (!text) continue;

    switch (localName) {
      case 'title':
        metadata.title = text;
        break;
      case 'creator':
        metadata.creator = text;
        break;
      case 'subject':
        metadata.subject = text;
        break;
      case 'description':
        metadata.description = text;
        break;
      case 'keywords':
        metadata.keywords = text
          .split(/[,;]/)
          .map((k) => k.trim())
          .filter(Boolean);
        break;
      case 'lastmodifiedby':
        metadata.lastModifiedBy = text;
        break;
      case 'revision':
        metadata.revision = isNaN(Number(text)) ? text : Number(text);
        break;
      case 'created':
        metadata.created = text;
        break;
      case 'modified':
        metadata.modified = text;
        break;
    }
  }

  return metadata;
}

/**
 * Parses ISO/IEC 29500-1 Extended Properties (docProps/app.xml).
 */
export function parseAppProperties(
  xmlString: string,
  adapter: XmlAdapter = defaultXmlAdapter,
): Partial<DocumentMetadata> {
  const root = adapter.parse(xmlString);
  const metadata: Partial<DocumentMetadata> = {};

  for (const child of root.children) {
    const localName = child.nodeName.replace(/^[a-zA-Z0-9]+:/, '').toLowerCase();
    const text = child.textContent?.trim();
    if (!text) continue;

    switch (localName) {
      case 'application':
        metadata.application = text;
        break;
      case 'company':
        metadata.company = text;
        break;
      case 'pages': {
        const val = Number(text);
        if (!isNaN(val)) metadata.pages = val;
        break;
      }
      case 'words': {
        const val = Number(text);
        if (!isNaN(val)) metadata.words = val;
        break;
      }
      case 'characters': {
        const val = Number(text);
        if (!isNaN(val)) metadata.characters = val;
        break;
      }
      case 'paragraphs': {
        const val = Number(text);
        if (!isNaN(val)) metadata.paragraphs = val;
        break;
      }
      case 'lines': {
        const val = Number(text);
        if (!isNaN(val)) metadata.lines = val;
        break;
      }
    }
  }

  return metadata;
}

/**
 * Parses document metadata from an OPC Package by inspecting docProps/core.xml and docProps/app.xml.
 */
export function parsePackageMetadata(
  pkg: OpcPackage,
  adapter: XmlAdapter = defaultXmlAdapter,
): DocumentMetadata | undefined {
  let result: DocumentMetadata | undefined;

  // Resolve core.xml part either from root relationships or default path
  let corePartPath = 'docProps/core.xml';
  const rootRels = pkg.getRelationships();
  const coreRel = rootRels.find((r) => r.type === KNOWN_RELATIONSHIPS.CORE_PROPERTIES);
  if (coreRel) {
    corePartPath = coreRel.target.replace(/^\/+/, '');
  }

  const corePart = pkg.getPart(corePartPath);
  if (corePart) {
    const coreMeta = parseCoreProperties(textDecoder.decode(corePart.data), adapter);
    result = { ...coreMeta };
  }

  // Resolve app.xml part either from root relationships or default path
  let appPartPath = 'docProps/app.xml';
  const appRel = rootRels.find((r) => r.type === KNOWN_RELATIONSHIPS.EXTENDED_PROPERTIES);
  if (appRel) {
    appPartPath = appRel.target.replace(/^\/+/, '');
  }

  const appPart = pkg.getPart(appPartPath);
  if (appPart) {
    const appMeta = parseAppProperties(textDecoder.decode(appPart.data), adapter);
    result = { ...result, ...appMeta };
  }

  return result;
}
