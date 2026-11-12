import {
  createDefaultContentTypesManifest,
  parseContentTypes,
  serializeContentTypes,
  type ContentTypesManifest,
} from './content-types.js';
import {
  getRelationshipsPath,
  parseRelationships,
  serializeRelationships,
  type OpcRelationship,
} from './relationships.js';
import { FflateZipReader } from './zip/zip-reader.js';
import { FflateZipWriter } from './zip/zip-writer.js';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/**
 * Open Packaging Conventions (OPC) Container abstraction.
 */

export interface OpcPart {
  name: string; // normalized path e.g. "word/document.xml"
  contentType: string;
  data: Uint8Array;
}

export interface OpcPackage {
  getPart(name: string): OpcPart | undefined;
  setPart(part: OpcPart): void;
  removePart(name: string): boolean;
  listParts(): string[];
  getContentTypes(): ContentTypesManifest;
  setContentType(partOrExt: string, contentType: string, isOverride?: boolean): void;
  getRelationships(partName?: string): OpcRelationship[];
  addRelationship(partName: string | undefined, rel: OpcRelationship): void;
  serialize(): Promise<Uint8Array>;
}

export function isValidPartName(name: string): boolean {
  const normalized = name.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.endsWith('/')) return false;
  const segments = normalized.split('/');
  return !segments.some((segment) => segment === '' || segment === '.' || segment === '..');
}

function normalizePartName(name: string): string {
  // Collapse dot segments so part-relative targets that climb with ../
  // resolve (F-PDOT-URI) with plain RFC 3986 semantics: a .. at the top
  // lands on the package root (word/../docProps/thumbnail.jpeg ->
  // docProps/thumbnail.jpeg), never clamps inside the leading segment.
  // Callers resolve relationship targets against the source part's
  // directory first; write-path validation rejects traversal names.
  const out: string[] = [];
  for (const seg of name.replace(/\\/g, '/').replace(/^\/+/, '').split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      out.pop();
      continue;
    }
    out.push(seg);
  }
  return out.join('/');
}

/**
 * Resolves a relationship target against its source part, the way OPC
 * resolves relative references (ISO/IEC 29500-2 §9.3.2): relative targets
 * join the source part's directory, absolute ones are package-rooted.
 * Dot segments collapse on lookup through `normalizePartName`.
 */
export function resolvePartTarget(sourcePart: string, target: string): string {
  const t = target.replace(/\\/g, '/');
  if (t.startsWith('/')) return normalizePartName(t);
  const src = sourcePart.replace(/\\/g, '/').replace(/^\/+/, '');
  const slash = src.lastIndexOf('/');
  const dir = slash >= 0 ? src.slice(0, slash + 1) : '';
  return normalizePartName(`${dir}${t}`);
}

export class StandardOpcPackage implements OpcPackage {
  private parts = new Map<string, OpcPart>();
  private contentTypes: ContentTypesManifest;
  private relationships = new Map<string, OpcRelationship[]>(); // key: normalized part name, '' = root

  constructor(contentTypes?: ContentTypesManifest) {
    this.contentTypes = contentTypes ? { ...contentTypes } : createDefaultContentTypesManifest();
  }

  getPart(name: string): OpcPart | undefined {
    return this.parts.get(normalizePartName(name));
  }

  setPart(part: OpcPart): void {
    if (!isValidPartName(part.name)) {
      throw new Error(`Invalid OPC part name "${part.name}": contains traversal or empty segments (ISO/IEC 29500-2 §9.1.1)`);
    }
    const normalized = normalizePartName(part.name);
    this.parts.set(normalized, {
      ...part,
      name: normalized,
    });
    this.setContentType('/' + normalized, part.contentType, true);
  }

  removePart(name: string): boolean {
    const normalized = normalizePartName(name);
    const deleted = this.parts.delete(normalized);
    if (deleted) {
      const partWithSlash = '/' + normalized;
      this.contentTypes.overrides = this.contentTypes.overrides.filter((o) => o.partName !== partWithSlash);
      this.relationships.delete(normalized);
    }
    return deleted;
  }

  listParts(): string[] {
    return Array.from(this.parts.keys());
  }

  getContentTypes(): ContentTypesManifest {
    return {
      defaults: [...this.contentTypes.defaults],
      overrides: [...this.contentTypes.overrides],
    };
  }

  setContentType(partOrExt: string, contentType: string, isOverride: boolean = false): void {
    if (isOverride || partOrExt.startsWith('/')) {
      const normalizedPart = partOrExt.startsWith('/') ? partOrExt : '/' + partOrExt;
      const existing = this.contentTypes.overrides.find((o) => o.partName === normalizedPart);
      if (existing) {
        existing.contentType = contentType;
      } else {
        this.contentTypes.overrides.push({ partName: normalizedPart, contentType });
      }
    } else {
      const ext = partOrExt.toLowerCase();
      const existing = this.contentTypes.defaults.find((d) => d.extension === ext);
      if (existing) {
        existing.contentType = contentType;
      } else {
        this.contentTypes.defaults.push({ extension: ext, contentType });
      }
    }
  }

  getRelationships(partName?: string): OpcRelationship[] {
    const key = partName ? normalizePartName(partName) : '';
    return [...(this.relationships.get(key) ?? [])];
  }

  addRelationship(partName: string | undefined, rel: OpcRelationship): void {
    const key = partName ? normalizePartName(partName) : '';
    const list = this.relationships.get(key) ?? [];
    const filtered = list.filter((r) => r.id !== rel.id);
    filtered.push(rel);
    this.relationships.set(key, filtered);
  }

  async serialize(): Promise<Uint8Array> {
    const writer = new FflateZipWriter();

    // 1. Write [Content_Types].xml
    const ctXml = serializeContentTypes(this.contentTypes);
    writer.addEntry('[Content_Types].xml', textEncoder.encode(ctXml));

    // 2. Write relationships (.rels)
    for (const [key, relList] of this.relationships.entries()) {
      if (relList.length > 0) {
        const relsPath = getRelationshipsPath(key);
        const relsXml = serializeRelationships(relList);
        writer.addEntry(relsPath, textEncoder.encode(relsXml));
      }
    }

    // 3. Write all parts
    for (const [name, part] of this.parts.entries()) {
      writer.addEntry(name, part.data);
    }

    return writer.generate();
  }
}

export function createPackage(): OpcPackage {
  return new StandardOpcPackage();
}

export async function openPackage(data: Uint8Array): Promise<OpcPackage> {
  const reader = new FflateZipReader();
  const entries = await reader.readEntries(data);

  // 1. Read [Content_Types].xml
  const ctData = entries.get('[Content_Types].xml');
  const manifest = ctData ? parseContentTypes(textDecoder.decode(ctData)) : createDefaultContentTypesManifest();

  const pkg = new StandardOpcPackage(manifest);

  // Helper to determine content type for a given part path
  function resolveContentType(partPath: string): string {
    const targetWithSlash = '/' + partPath;
    const override = manifest.overrides.find((o) => o.partName === targetWithSlash);
    if (override) return override.contentType;

    const dotIndex = partPath.lastIndexOf('.');
    if (dotIndex !== -1) {
      const ext = partPath.slice(dotIndex + 1).toLowerCase();
      const def = manifest.defaults.find((d) => d.extension === ext);
      if (def) return def.contentType;
    }

    return 'application/octet-stream';
  }

  // 2. Read all relationships files
  for (const [path, entryData] of entries.entries()) {
    if (path.endsWith('.rels')) {
      const rels = parseRelationships(textDecoder.decode(entryData));
      if (path === '_rels/.rels') {
        for (const rel of rels) {
          pkg.addRelationship(undefined, rel);
        }
      } else {
        // e.g. "word/_rels/document.xml.rels" -> source part is "word/document.xml"
        const sourcePart = path.replace('/_rels/', '/').replace(/\.rels$/, '');
        for (const rel of rels) {
          pkg.addRelationship(sourcePart, rel);
        }
      }
    }
  }

  // 3. Load parts (excluding [Content_Types].xml and *.rels)
  for (const [path, entryData] of entries.entries()) {
    if (path === '[Content_Types].xml' || path.endsWith('.rels')) {
      continue;
    }
    const contentType = resolveContentType(path);
    pkg.setPart({
      name: path,
      contentType,
      data: entryData,
    });
  }

  return pkg;
}
