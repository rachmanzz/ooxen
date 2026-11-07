/**
 * Generates ISO/IEC 29500-1 word/numbering.xml parts for bullet and numbered lists.
 */

export interface NumberingBuilder {
  /**
   * Builds numbering.xml. `requiredNumIds` maps every numId referenced by
   * the document to its format hint ('bullet' | 'decimal' | ...): ids
   * beyond the built-in 1/2 get synthesized generic definitions so refs
   * never dangle (F-NUMDANGLE). Omitted or covered ids keep the exact
   * historical default output.
   */
  buildDefaultNumberingXml(requiredNumIds?: ReadonlyMap<number, string | undefined>): string;
}

export class StandardNumberingBuilder implements NumberingBuilder {
  buildDefaultNumberingXml(requiredNumIds?: ReadonlyMap<number, string | undefined>): string {
    const lines = [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
      '  <!-- Abstract Numbering 1: Standard Bullet List -->',
      '  <w:abstractNum w:abstractNumId="1">',
      '    <w:multiLevelType w:val="hybridMultilevel"/>',
      '    <w:lvl w:ilvl="0">',
      '      <w:start w:val="1"/>',
      '      <w:numFmt w:val="bullet"/>',
      '      <w:lvlText w:val="•"/>',
      '      <w:lvlJc w:val="left"/>',
      '      <w:pPr>',
      '        <w:ind w:left="720" w:hanging="360"/>',
      '      </w:pPr>',
      '      <w:rPr>',
      '        <w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/>',
      '      </w:rPr>',
      '    </w:lvl>',
      '    <w:lvl w:ilvl="1">',
      '      <w:start w:val="1"/>',
      '      <w:numFmt w:val="bullet"/>',
      '      <w:lvlText w:val="◦"/>',
      '      <w:lvlJc w:val="left"/>',
      '      <w:pPr>',
      '        <w:ind w:left="1440" w:hanging="360"/>',
      '      </w:pPr>',
      '    </w:lvl>',
      '  </w:abstractNum>',
      '  <!-- Abstract Numbering 2: Standard Decimal / Multilevel Numbered List -->',
      '  <w:abstractNum w:abstractNumId="2">',
      '    <w:multiLevelType w:val="multilevel"/>',
      '    <w:lvl w:ilvl="0">',
      '      <w:start w:val="1"/>',
      '      <w:numFmt w:val="decimal"/>',
      '      <w:lvlText w:val="%1."/>',
      '      <w:lvlJc w:val="left"/>',
      '      <w:pPr>',
      '        <w:ind w:left="720" w:hanging="360"/>',
      '      </w:pPr>',
      '    </w:lvl>',
      '    <w:lvl w:ilvl="1">',
      '      <w:start w:val="1"/>',
      '      <w:numFmt w:val="lowerLetter"/>',
      '      <w:lvlText w:val="%2."/>',
      '      <w:lvlJc w:val="left"/>',
      '      <w:pPr>',
      '        <w:ind w:left="1440" w:hanging="360"/>',
      '      </w:pPr>',
      '    </w:lvl>',
      '    <w:lvl w:ilvl="2">',
      '      <w:start w:val="1"/>',
      '      <w:numFmt w:val="lowerRoman"/>',
      '      <w:lvlText w:val="%3."/>',
      '      <w:lvlJc w:val="left"/>',
      '      <w:pPr>',
      '        <w:ind w:left="2160" w:hanging="360"/>',
      '      </w:pPr>',
      '    </w:lvl>',
      '  </w:abstractNum>',
      '  <!-- Concrete Numbering Instances -->',
      '  <w:num w:numId="1">',
      '    <w:abstractNumId w:val="1"/>',
      '  </w:num>',
      '  <w:num w:numId="2">',
      '    <w:abstractNumId w:val="2"/>',
      '  </w:num>',
      ...this.buildExtraNumbering(requiredNumIds),
      '</w:numbering>',
    ];
    return lines.join('\n');
  }

  /**
   * Synthesizes generic single-level definitions for referenced numIds
   * beyond the built-in 1/2, so programmatic documents never emit
   * dangling numbering refs. Format hint selects bullet vs decimal.
   */
  private buildExtraNumbering(requiredNumIds?: ReadonlyMap<number, string | undefined>): string[] {
    if (!requiredNumIds) return [];
    const out: string[] = [];
    for (const numId of [...requiredNumIds.keys()].sort((a, b) => a - b)) {
      if (numId === 1 || numId === 2 || !Number.isInteger(numId) || numId < 0) continue;
      const abstractId = 1000 + numId;
      const bullet = requiredNumIds.get(numId) === 'bullet';
      out.push(
        `  <!-- Synthesized generic definition for numId ${numId} (F-NUMDANGLE) -->`,
        `  <w:abstractNum w:abstractNumId="${abstractId}">`,
        '    <w:multiLevelType w:val="singleLevel"/>',
        '    <w:lvl w:ilvl="0">',
        '      <w:start w:val="1"/>',
        bullet ? '      <w:numFmt w:val="bullet"/>' : '      <w:numFmt w:val="decimal"/>',
        bullet ? '      <w:lvlText w:val="\u2022"/>' : '      <w:lvlText w:val="%1."/>',
        '      <w:lvlJc w:val="left"/>',
        '      <w:pPr>',
        '        <w:ind w:left="720" w:hanging="360"/>',
        '      </w:pPr>',
        '    </w:lvl>',
        '  </w:abstractNum>',
        `  <w:num w:numId="${numId}">`,
        `    <w:abstractNumId w:val="${abstractId}"/>`,
        '  </w:num>',
      );
    }
    return out;
  }
}

export const defaultNumberingBuilder = new StandardNumberingBuilder();
