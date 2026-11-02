import { zipSync } from 'fflate';

/**
 * Runtime-agnostic ZIP package writer interface.
 */

export interface ZipWriter {
  addEntry(path: string, data: Uint8Array): void;
  generate(): Promise<Uint8Array>;
}

export class FflateZipWriter implements ZipWriter {
  private entries: Record<string, Uint8Array> = {};

  addEntry(path: string, data: Uint8Array): void {
    const normalizedPath = path.replace(/\\/g, '/').replace(/^\/+/, '');
    this.entries[normalizedPath] = data;
  }

  async generate(): Promise<Uint8Array> {
    return zipSync(this.entries);
  }
}
