import type {
  BlockNode,
  CommentNode,
  DocumentNode,
  DrawingShapeNode,
  FootnoteNode,
  HeaderFooterNode,
  ImageNode,
  ParagraphNode,
  SectionNode,
  TableNode,
} from './ast.js';

/**
 * Block-level floats (F-HTMLFLOAT).
 *
 * The WML parser never emits a block-level `DrawingShapeNode`/`ImageNode`:
 * a `wp:anchor` always sits in a run of Word's (often empty) host
 * paragraph. A hand-built AST may still place an anchored drawing or
 * image directly in a block list. Both renderers treat that as the same
 * thing Word does: an empty paragraph hosting the float, which takes one
 * empty line of flow while the float resolves against its anchor.
 *
 * This pass rewrites every such block, once, at the renderer entry
 * points, so the body, header/footer, table-cell, footnote, and comment
 * loops only ever see paragraphs and tables and no consumer has to
 * remember the special case. Untouched subtrees are returned as-is.
 */

export function floatHostParagraph(block: DrawingShapeNode | ImageNode): ParagraphNode {
  return {
    type: 'paragraph',
    children: [block.type === 'drawing' ? { type: 'run', text: '', drawing: block } : { type: 'run', text: '', image: block }],
  };
}

/** Maps with copy-on-write: the input array comes back when nothing changed. */
function mapCow<T>(items: T[], fn: (item: T) => T): T[] {
  let out: T[] | undefined;
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    const next = fn(item);
    if (out) out.push(next);
    else if (next !== item) {
      out = items.slice(0, i);
      out.push(next);
    }
  }
  return out ?? items;
}

function hostTableFloats(table: TableNode): TableNode {
  const rows = mapCow(table.rows, (row) => {
    const cells = mapCow(row.children, (cell) => {
      const children = hostBlockFloats(cell.children);
      return children === cell.children ? cell : { ...cell, children };
    });
    return cells === row.children ? row : { ...row, children: cells };
  });
  return rows === table.rows ? table : { ...table, rows };
}

function hostBlockFloat(block: BlockNode): BlockNode {
  if (block.type === 'paragraph') return block;
  if (block.type === 'table') return hostTableFloats(block);
  return block.anchor ? floatHostParagraph(block) : block;
}

/** Block list with every block-level float wrapped in its host paragraph. */
export function hostBlockFloats(blocks: BlockNode[]): BlockNode[] {
  return mapCow(blocks, hostBlockFloat);
}

function hostChildren<T extends { children: BlockNode[] }>(node: T): T {
  const children = hostBlockFloats(node.children);
  return children === node.children ? node : { ...node, children };
}

function hostHeaderFooters<T extends Partial<Record<'default' | 'first' | 'even', HeaderFooterNode>>>(group: T | undefined): T | undefined {
  if (!group) return group;
  let out: T | undefined;
  for (const kind of ['default', 'first', 'even'] as const) {
    const node = group[kind];
    if (!node) continue;
    const next = hostChildren(node);
    if (next !== node) {
      out ??= { ...group };
      out[kind] = next;
    }
  }
  return out ?? group;
}

function hostSectionFloats(section: SectionNode): SectionNode {
  const children = hostBlockFloats(section.children);
  const headers = hostHeaderFooters(section.headers);
  const footers = hostHeaderFooters(section.footers);
  if (children === section.children && headers === section.headers && footers === section.footers) return section;
  return { ...section, children, headers, footers };
}

/** The document with every block-level float, anywhere in the tree, hosted by a paragraph. */
export function hostDocumentBlockFloats(document: DocumentNode): DocumentNode {
  const sections = mapCow(document.sections, hostSectionFloats);
  const footnotes = document.footnotes ? mapCow(document.footnotes, (n: FootnoteNode) => hostChildren(n)) : document.footnotes;
  const endnotes = document.endnotes ? mapCow(document.endnotes, (n: FootnoteNode) => hostChildren(n)) : document.endnotes;
  const comments = document.comments ? mapCow(document.comments, (n: CommentNode) => hostChildren(n)) : document.comments;
  if (
    sections === document.sections &&
    footnotes === document.footnotes &&
    endnotes === document.endnotes &&
    comments === document.comments
  ) {
    return document;
  }
  return { ...document, sections, footnotes, endnotes, comments };
}
