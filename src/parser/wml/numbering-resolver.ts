import { twipsToPt } from '../../types/common.js';
import type { ParagraphNumbering } from '../../types/style.js';
import { defaultXmlAdapter, type XmlAdapter, type XmlNode } from '../xml-adapter.js';

export type NumberFormatType =
  | 'decimal'
  | 'bullet'
  | 'lowerLetter'
  | 'upperLetter'
  | 'lowerRoman'
  | 'upperRoman'
  | 'none';

export interface NumberingLevelDefinition {
  level: number;
  start: number;
  format: NumberFormatType;
  levelText: string;
  indentLeftPt?: number;
  hangingPt?: number;
}

export interface AbstractNumberingDefinition {
  abstractNumId: number;
  levels: Map<number, NumberingLevelDefinition>;
}

export interface ConcreteNumberingInstance {
  numId: number;
  abstractNumId: number;
}

export interface ResolvedNumbering extends ParagraphNumbering {
  indentLeftPt?: number;
  hangingPt?: number;
}

export interface NumberingResolver {
  parseNumberingXml(xmlOrNode: string | XmlNode): void;
  resolveNumbering(numId: number, level: number): ResolvedNumbering | undefined;
  reset(): void;
}

/**
 * Normalizes case-insensitive number format strings into canonical NumberFormatType
 */
export function normalizeNumberFormat(raw?: string): NumberFormatType {
  if (!raw) return 'decimal';
  const lower = raw.toLowerCase();
  switch (lower) {
    case 'decimal':
      return 'decimal';
    case 'bullet':
      return 'bullet';
    case 'lowerletter':
      return 'lowerLetter';
    case 'upperletter':
      return 'upperLetter';
    case 'lowerroman':
      return 'lowerRoman';
    case 'upperroman':
      return 'upperRoman';
    case 'none':
      return 'none';
    default:
      return 'decimal';
  }
}

/**
 * Converts integer to lowercase letters (1 -> 'a', 26 -> 'z', 27 -> 'aa')
 */
export function toLowerLetter(n: number): string {
  if (n <= 0) return 'a';
  let result = '';
  let temp = n;
  while (temp > 0) {
    temp--;
    result = String.fromCharCode(97 + (temp % 26)) + result;
    temp = Math.floor(temp / 26);
  }
  return result;
}

/**
 * Converts integer to Roman numeral string
 */
export function toRoman(n: number, upper: boolean = false): string {
  if (n <= 0) return '1';
  const lookup: [number, string][] = [
    [1000, 'm'],
    [900, 'cm'],
    [500, 'd'],
    [400, 'cd'],
    [100, 'c'],
    [90, 'xc'],
    [50, 'l'],
    [40, 'xl'],
    [10, 'x'],
    [9, 'ix'],
    [5, 'v'],
    [4, 'iv'],
    [1, 'i'],
  ];

  let roman = '';
  let num = n;
  for (const [val, str] of lookup) {
    while (num >= val) {
      roman += str;
      num -= val;
    }
  }

  return upper ? roman.toUpperCase() : roman;
}

/**
 * Normalizes Wingdings / Private Use Area bullets to clean Unicode
 */
export function normalizeBulletSymbol(rawText: string): string {
  if (!rawText || rawText.length === 0) return '•';
  // Common Word symbol bullet characters
  if (rawText === '' || rawText === '\uF0B7' || rawText === '•') return '•';
  if (rawText === 'o' || rawText === '\uF0A1') return '◦';
  if (rawText === '' || rawText === '\uF0A7') return '▪';
  if (rawText === '–' || rawText === '-') return '-';
  return rawText;
}

export class StandardNumberingResolver implements NumberingResolver {
  private abstractNums: Map<number, AbstractNumberingDefinition> = new Map();
  private concreteNums: Map<number, ConcreteNumberingInstance> = new Map();
  private counters: Map<number, number[]> = new Map();
  private xmlAdapter: XmlAdapter;

  constructor(xmlAdapter: XmlAdapter = defaultXmlAdapter) {
    this.xmlAdapter = xmlAdapter;
  }

  reset(): void {
    this.counters.clear();
  }

  parseNumberingXml(xmlOrNode: string | XmlNode): void {
    const rootNode = typeof xmlOrNode === 'string' ? this.xmlAdapter.parse(xmlOrNode) : xmlOrNode;

    let numberingNode: XmlNode | undefined;
    if (rootNode.nodeName.toLowerCase().endsWith('numbering')) {
      numberingNode = rootNode;
    } else {
      numberingNode = rootNode.children.find((c) => c.nodeName.toLowerCase().endsWith('numbering'));
    }

    if (!numberingNode) return;

    for (const child of numberingNode.children) {
      const tag = child.nodeName.replace(/^[a-zA-Z0-9]+:/, '').toLowerCase();

      if (tag === 'abstractnum') {
        const idStr = child.attributes['w:abstractNumId'] ?? child.attributes['abstractNumId'];
        if (!idStr) continue;
        const abstractNumId = Number.parseInt(idStr, 10);
        const levels = new Map<number, NumberingLevelDefinition>();

        for (const lvlNode of child.children) {
          const lTag = lvlNode.nodeName.replace(/^[a-zA-Z0-9]+:/, '').toLowerCase();
          if (lTag === 'lvl') {
            const ilvlStr = lvlNode.attributes['w:ilvl'] ?? lvlNode.attributes['ilvl'] ?? '0';
            const ilvl = Number.parseInt(ilvlStr, 10);

            let start = 1;
            let format: NumberFormatType = 'decimal';
            let levelText = `%${ilvl + 1}.`;
            let indentLeftPt: number | undefined;
            let hangingPt: number | undefined;

            for (const prop of lvlNode.children) {
              const pTag = prop.nodeName.replace(/^[a-zA-Z0-9]+:/, '').toLowerCase();
              if (pTag === 'start') {
                const sVal = prop.attributes['w:val'] ?? prop.attributes['val'];
                if (sVal) start = Number.parseInt(sVal, 10);
              } else if (pTag === 'numfmt') {
                const fVal = prop.attributes['w:val'] ?? prop.attributes['val'];
                if (fVal) format = normalizeNumberFormat(fVal);
              } else if (pTag === 'lvltext') {
                const tVal = prop.attributes['w:val'] ?? prop.attributes['val'];
                if (tVal) levelText = tVal;
              } else if (pTag === 'ppr') {
                const ind = prop.children.find((c) => c.nodeName.toLowerCase().endsWith('ind'));
                if (ind) {
                  const left = ind.attributes['w:left'] ?? ind.attributes['left'];
                  const hanging = ind.attributes['w:hanging'] ?? ind.attributes['hanging'];
                  if (left) indentLeftPt = twipsToPt(Number(left));
                  if (hanging) hangingPt = twipsToPt(Number(hanging));
                }
              }
            }

            levels.set(ilvl, {
              level: ilvl,
              start,
              format,
              levelText,
              indentLeftPt,
              hangingPt,
            });
          }
        }

        this.abstractNums.set(abstractNumId, { abstractNumId, levels });
      } else if (tag === 'num') {
        const numIdStr = child.attributes['w:numId'] ?? child.attributes['numId'];
        if (!numIdStr) continue;
        const numId = Number.parseInt(numIdStr, 10);

        const absRef = child.children.find((c) => c.nodeName.toLowerCase().endsWith('abstractnumid'));
        const absVal = absRef?.attributes['w:val'] ?? absRef?.attributes['val'];
        const abstractNumId = absVal ? Number.parseInt(absVal, 10) : 0;

        this.concreteNums.set(numId, { numId, abstractNumId });
      }
    }
  }

  resolveNumbering(numId: number, level: number): ResolvedNumbering | undefined {
    const concrete = this.concreteNums.get(numId);
    if (!concrete) {
      // Fallback: simple 1-based decimal counter
      return {
        numId,
        level,
        format: 'decimal',
        prefixText: `${level + 1}.`,
      };
    }

    const abstractDef = this.abstractNums.get(concrete.abstractNumId);
    if (!abstractDef) return undefined;

    const levelDef = abstractDef.levels.get(level);
    if (!levelDef) return undefined;

    // Initialize or get counter array for this numId
    if (!this.counters.has(numId)) {
      this.counters.set(numId, []);
    }
    const currentCounters = this.counters.get(numId)!;

    // Ensure array is large enough
    while (currentCounters.length <= level) {
      const idx = currentCounters.length;
      const lDef = abstractDef.levels.get(idx);
      currentCounters.push((lDef?.start ?? 1) - 1);
    }

    // Increment current level
    currentCounters[level] = (currentCounters[level] ?? 0) + 1;

    // Reset deeper levels
    for (let deeper = level + 1; deeper < currentCounters.length; deeper++) {
      const dDef = abstractDef.levels.get(deeper);
      currentCounters[deeper] = (dDef?.start ?? 1) - 1;
    }

    if (levelDef.format === 'bullet') {
      return {
        numId,
        level,
        format: 'bullet',
        prefixText: normalizeBulletSymbol(levelDef.levelText),
        indentLeftPt: levelDef.indentLeftPt,
        hangingPt: levelDef.hangingPt,
      };
    }

    if (levelDef.format === 'none') {
      return {
        numId,
        level,
        format: 'none',
        prefixText: '',
        indentLeftPt: levelDef.indentLeftPt,
        hangingPt: levelDef.hangingPt,
      };
    }

    // Format all levels up to current level for template string replacement (%1, %2, ...)
    let resolvedText = levelDef.levelText;
    for (let k = 0; k <= level; k++) {
      const kDef = abstractDef.levels.get(k);
      const kVal = currentCounters[k] ?? 1;
      const formattedK = this.formatValue(kVal, kDef?.format ?? 'decimal');
      resolvedText = resolvedText.replace(new RegExp(`%${k + 1}`, 'g'), formattedK);
    }

    return {
      numId,
      level,
      format: levelDef.format,
      prefixText: resolvedText,
      indentLeftPt: levelDef.indentLeftPt,
      hangingPt: levelDef.hangingPt,
    };
  }

  private formatValue(value: number, format: NumberFormatType): string {
    switch (format.toLowerCase()) {
      case 'decimal':
        return String(value);
      case 'lowerletter':
        return toLowerLetter(value);
      case 'upperletter':
        return toLowerLetter(value).toUpperCase();
      case 'lowerroman':
        return toRoman(value, false);
      case 'upperroman':
        return toRoman(value, true);
      default:
        return String(value);
    }
  }
}

export const defaultNumberingResolver = new StandardNumberingResolver();
