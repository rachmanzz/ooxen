import { zipSync } from 'fflate';

/**
 * Runtime-agnostic ZIP package writer interface.
 */

export interface ZipWriter {
  addEntry(path: string, data: Uint8Array): void;
  generate(): Promise<Uint8Array>;
}

export class FflateZipWriter implements ZipWriter {
  // Null-prototype map: crafted part names ("__proto__", "constructor") must
  // never reach Object.prototype (prototype pollution — v1 F18).
  private entries: Record<string, Uint8Array> = Object.create(null);

  addEntry(path: string, data: Uint8Array): void {
    const normalizedPath = path.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!normalizedPath) return;
    this.entries[normalizedPath] = data;
  }

  async generate(): Promise<Uint8Array> {
    return zipSync(this.entries);
  }
}
