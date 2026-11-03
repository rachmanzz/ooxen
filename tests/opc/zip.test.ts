import { describe, expect, it } from 'bun:test';
import { FflateZipReader } from '../../src/opc/zip/zip-reader.js';
import { FflateZipWriter } from '../../src/opc/zip/zip-writer.js';

describe('OPC Zip Adapter', () => {
  it('should write and read zip entries correctly', async () => {
    const writer = new FflateZipWriter();
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    writer.addEntry('hello.txt', encoder.encode('Hello World'));
    writer.addEntry('nested/dir/test.xml', encoder.encode('<root><item/></root>'));

    const zipBuffer = await writer.generate();
    expect(zipBuffer).toBeInstanceOf(Uint8Array);
    expect(zipBuffer.length).toBeGreaterThan(0);

    const reader = new FflateZipReader();
    const entries = await reader.readEntries(zipBuffer);

    expect(entries.size).toBe(2);
    expect(entries.has('hello.txt')).toBe(true);
    expect(entries.has('nested/dir/test.xml')).toBe(true);

    const helloContent = entries.get('hello.txt');
    expect(helloContent).toBeDefined();
    expect(decoder.decode(helloContent!)).toBe('Hello World');

    const xmlContent = entries.get('nested/dir/test.xml');
    expect(xmlContent).toBeDefined();
    expect(decoder.decode(xmlContent!)).toBe('<root><item/></root>');
  });

  it('should reject zip slip path traversal and empty segments (ISO/IEC 29500-2 §9.1.1)', async () => {
    const writer = new FflateZipWriter();
    const encoder = new TextEncoder();

    writer.addEntry('../../etc/passwd', encoder.encode('root:x:0:0'));
    writer.addEntry('word/../../traversal.txt', encoder.encode('malicious'));
    writer.addEntry('word/./current.txt', encoder.encode('dot-segment'));
    writer.addEntry('word//double-slash.txt', encoder.encode('empty-segment'));
    writer.addEntry('word/valid.xml', encoder.encode('<valid/>'));

    const zipBuffer = await writer.generate();
    const reader = new FflateZipReader();
    const entries = await reader.readEntries(zipBuffer);

    expect(entries.size).toBe(1);
    expect(entries.has('word/valid.xml')).toBe(true);
    expect(entries.has('../../etc/passwd')).toBe(false);
    expect(entries.has('word/../../traversal.txt')).toBe(false);
    expect(entries.has('word/./current.txt')).toBe(false);
    expect(entries.has('word//double-slash.txt')).toBe(false);
  });
});
