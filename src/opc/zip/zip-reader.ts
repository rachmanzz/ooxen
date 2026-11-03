import { unzipSync } from 'fflate';

/**
 * Runtime-agnostic ZIP package reader interface.
 * Operates purely on Uint8Array buffers without Node.js 'fs' or 'zlib' dependencies.
 */

export interface ZipEntry {
  path: string;
  data: Uint8Array;
}

export interface ZipReader {
  readEntries(buffer: Uint8Array): Promise<Map<string, Uint8Array>>;
}

export class FflateZipReader implements ZipReader {
  async readEntries(buffer: Uint8Array): Promise<Map<string, Uint8Array>> {
    const unzipped = unzipSync(buffer);
    const result = new Map<string, Uint8Array>();

    for (const [rawPath, data] of Object.entries(unzipped)) {
      // Normalize path: replace backslashes and remove leading slash
      const normalizedPath = rawPath.replace(/\\/g, '/').replace(/^\/+/, '');
      if (normalizedPath.length === 0 || normalizedPath.endsWith('/')) {
        continue;
      }

      // ISO/IEC 29500-2 §9.1.1 & Anti-Zip Slip Protection:
      // Part names must not contain empty segments, single-dot ('.'), or double-dot ('..') segments.
      const segments = normalizedPath.split('/');
      const isInvalid = segments.some((segment) => segment === '' || segment === '.' || segment === '..');
      if (isInvalid) {
        continue;
      }

      result.set(normalizedPath, data);
    }

    return result;
  }
}
