/**
 * Loader for fonts embedded in a DOCX package (fontTable.xml + ODTTF).
 *
 * Word embeds fonts as `word/fonts/fontN.odttf` parts referenced from
 * `word/fontTable.xml` via `w:embedRegular`/`w:embedBold`/... relationship
 * elements. ODTTF obfuscation XORs the first 32 bytes of the font with the
 * 16 GUID bytes from `w:fontKey` in reverse order; deobfuscating them yields
 * a plain TTF/OTF that can be parsed for real glyph metrics (futures §5.2).
 */

import type { OpcPackage } from '../opc/package.js';
import { defaultXmlAdapter } from '../parser/xml-adapter.js';
import { globalFontMetrics, type FontMetricsRegistry, type FontVariant } from './font-metrics-registry.js';

const FONT_TABLE_PART = 'word/fontTable.xml';

/** Reverses ODTTF font-key obfuscation on the first 32 bytes. */
export function deobfuscateOdttf(data: Uint8Array, fontKey: string): Uint8Array {
  const hex = fontKey.replace(/[{}-]/g, '');
  if (hex.length < 32) throw new Error('Invalid ODTTF fontKey: expected a 16-byte GUID');
  const guid = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    guid[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  const result = data.slice();
  for (let i = 0; i < 32 && i < result.length; i++) {
    result[i] = result[i]! ^ guid[15 - (i % 16)]!;
  }
  return result;
}

function resolveWordPartPath(target: string): string {
  return target.startsWith('word/') ? target : `word/${target.replace(/^\/+/, '')}`;
}

/**
 * Registers every embedded font found in the package into the given registry.
 * Returns the number of successfully registered faces; malformed or missing
 * entries are skipped silently — embedded fonts are an optimization, and a
 * failure must never block document parsing.
 */
export function loadEmbeddedFonts(pkg: OpcPackage, registry: FontMetricsRegistry = globalFontMetrics): number {
  let registered = 0;

  try {
    const fontTablePart = pkg.getPart(FONT_TABLE_PART);
    if (!fontTablePart) return 0;

    const fontTable = defaultXmlAdapter.parse(new TextDecoder().decode(fontTablePart.data));
    const rels = pkg.getRelationships(FONT_TABLE_PART);
    const relById = new Map(rels.map((rel) => [rel.id, rel]));

    for (const fontNode of fontTable.children.filter((c) => c.nodeName.toLowerCase().endsWith('font'))) {
      const family = fontNode.attributes['w:name'] ?? fontNode.attributes['name'];
      if (!family) continue;

      for (const embed of fontNode.children) {
        const tag = embed.nodeName.replace(/^[a-zA-Z0-9]+:/, '').toLowerCase();
        let variant: FontVariant | undefined;
        if (tag === 'embedregular') variant = 'regular';
        else if (tag === 'embedbold') variant = 'bold';
        else if (tag === 'embeditalic') variant = 'italic';
        else if (tag === 'embedbolditalic') variant = 'boldItalic';
        if (!variant) continue;

        const relId = embed.attributes['r:id'] ?? embed.attributes['id'];
        const fontKey = embed.attributes['w:fontKey'] ?? embed.attributes['fontKey'] ?? '';
        const rel = relId ? relById.get(relId) : undefined;
        if (!rel) continue;

        const fontPart = pkg.getPart(resolveWordPartPath(rel.target));
        if (!fontPart) continue;

        try {
          const fontData = fontKey ? deobfuscateOdttf(fontPart.data, fontKey) : fontPart.data;
          registry.register(fontData, family, variant);
          registered++;
        } catch {
          // Unparseable font data — skip this face.
        }
      }
    }
  } catch {
    // fontTable.xml missing or malformed — no embedded fonts, not an error.
  }

  return registered;
}
