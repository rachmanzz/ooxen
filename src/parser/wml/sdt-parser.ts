import type { ImageResolver } from '../dml/image-parser.js';
import type { XmlNode } from '../xml-adapter.js';
import type { NumberingResolver } from './numbering-resolver.js';
import type { HyperlinkResolver, ParagraphParser } from './paragraph-parser.js';
import type { StyleResolver } from './style-resolver.js';
import type { TableParser } from './table-parser.js';
import type { BlockNode } from '../../types/ast.js';

/**
 * Unwraps Word content controls (`w:sdt` → `w:sdtContent`) into ordinary
 * blocks (F-VMLSDT). Only the control wrapper (alias, tag, lock, data
 * binding) is dropped; the authored content parses exactly as if the
 * wrapper never existed. Nested controls recurse.
 */
export function parseSdtContentBlocks(
  node: XmlNode,
  styleResolver: StyleResolver | undefined,
  numberingResolver: NumberingResolver | undefined,
  imageResolver: ImageResolver | undefined,
  hyperlinkResolver: HyperlinkResolver | undefined,
  paragraphParser: ParagraphParser,
  tableParser: TableParser,
): BlockNode[] {
  const content = node.children.find((c) =>
    c.nodeName.replace(/^[a-zA-Z0-9]+:/, '').toLowerCase() === 'sdtcontent',
  );
  const scope = content ?? node;
  const blocks: BlockNode[] = [];

  for (const child of scope.children) {
    const tag = child.nodeName.replace(/^[a-zA-Z0-9]+:/, '').toLowerCase();
    if (tag === 'p') {
      blocks.push(
        paragraphParser.parseParagraph(child, styleResolver, numberingResolver, imageResolver, hyperlinkResolver),
      );
      blocks.push(...(paragraphParser.drainPendingBlocks?.() ?? []));
    } else if (tag === 'tbl') {
      blocks.push(tableParser.parseTable(child, styleResolver, numberingResolver));
    } else if (tag === 'sdt') {
      blocks.push(
        ...parseSdtContentBlocks(
          child,
          styleResolver,
          numberingResolver,
          imageResolver,
          hyperlinkResolver,
          paragraphParser,
          tableParser,
        ),
      );
    }
  }

  return blocks;
}
