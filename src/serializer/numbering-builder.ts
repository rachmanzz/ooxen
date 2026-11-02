/**
 * Generates ISO/IEC 29500-1 word/numbering.xml parts for bullet and numbered lists.
 */

export interface NumberingBuilder {
  buildDefaultNumberingXml(): string;
}

export class StandardNumberingBuilder implements NumberingBuilder {
  buildDefaultNumberingXml(): string {
    return [
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
      '</w:numbering>',
    ].join('\n');
  }
}

export const defaultNumberingBuilder = new StandardNumberingBuilder();
