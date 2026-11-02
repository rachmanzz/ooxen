/**
 * Runtime-agnostic ZIP package writer interface.
 */

export interface ZipWriter {
  addEntry(path: string, data: Uint8Array): void;
  generate(): Promise<Uint8Array>;
}
