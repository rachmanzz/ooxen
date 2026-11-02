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
