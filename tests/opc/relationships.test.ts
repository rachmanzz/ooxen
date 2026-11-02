import { describe, expect, it } from 'bun:test';
import {
  getRelationshipsPath,
  KNOWN_RELATIONSHIPS,
  parseRelationships,
  serializeRelationships,
  type OpcRelationship,
} from '../../src/opc/relationships.js';

describe('OPC Relationships', () => {
  it('should compute relationship file paths correctly', () => {
    expect(getRelationshipsPath()).toBe('_rels/.rels');
    expect(getRelationshipsPath('')).toBe('_rels/.rels');
    expect(getRelationshipsPath('/')).toBe('_rels/.rels');
    expect(getRelationshipsPath('word/document.xml')).toBe('word/_rels/document.xml.rels');
    expect(getRelationshipsPath('/word/document.xml')).toBe('word/_rels/document.xml.rels');
  });

  it('should parse and serialize relationships accurately', () => {
    const rels: OpcRelationship[] = [
      {
        id: 'rId1',
        type: KNOWN_RELATIONSHIPS.DOCUMENT,
        target: 'word/document.xml',
      },
      {
        id: 'rId2',
        type: KNOWN_RELATIONSHIPS.STYLES,
        target: 'styles.xml',
      },
    ];

    const xml = serializeRelationships(rels);
    expect(xml).toContain('<Relationships');
    expect(xml).toContain('Id="rId1"');
    expect(xml).toContain('Target="word/document.xml"');

    const parsed = parseRelationships(xml);
    expect(parsed.length).toBe(2);
    expect(parsed[0]?.id).toBe('rId1');
    expect(parsed[0]?.target).toBe('word/document.xml');
    expect(parsed[1]?.id).toBe('rId2');
    expect(parsed[1]?.target).toBe('styles.xml');
  });
});
