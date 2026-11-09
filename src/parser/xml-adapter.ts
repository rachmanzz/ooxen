/**
 * Isomorphic XML reader and DOM-like node interface.
 * Decoupled from browser global DOM or Node.js-only packages.
 *
 * Lossless design (futures §5.1): every parsed document keeps a typed
 * `childNodes` list that preserves the exact document order of elements,
 * text nodes (including whitespace-only ones), and comments. `children`
 * remains an element-only view for backward compatibility with existing
 * consumers, and `textContent` stays the folded convenience accessor.
 * `serializeXmlNode` re-emits the tree so that
 * `serialize(parse(serialize(parse(x)))) === serialize(parse(x))` — the XML
 * infoset survives a parse/serialize cycle unchanged.
 */

export type XmlNodeKind = 'element' | 'text' | 'comment';

export interface XmlNode {
  /** Discriminator for typed nodes. Absent (legacy) means 'element'. */
  kind?: XmlNodeKind;
  nodeName: string;
  namespaceUri?: string;
  attributes: Record<string, string>;
  /**
   * Exact ordered child list: elements, text nodes, and comments. Only
   * present on element nodes; text and comment nodes are leaves.
   */
  children: XmlNode[];
  /**
   * Full ordered child list including text ('#text') and comment
   * ('#comment') nodes — the lossless view. Absent on leaves.
   */
  childNodes?: XmlNode[];
  /** Folded text of all descendant text nodes (document order). */
  textContent: string;
  /** Raw value for text/comment nodes. */
  value?: string;
}

export interface XmlAdapter {
  parse(xmlString: string): XmlNode;
}

export const TEXT_NODE_NAME = '#text';
export const COMMENT_NODE_NAME = '#comment';

export function isElementNode(node: XmlNode): boolean {
  return (node.kind ?? 'element') === 'element';
}

export function isTextNode(node: XmlNode): boolean {
  return node.kind === 'text';
}

function decodeXmlEntities(text: string): string {
  // Numeric references decode first so an escaped &amp;#65; stays literal
  // instead of double-decoding (F-PENT-REF). Out-of-range or surrogate
  // code points are left literal.
  return text
    .replace(/&#([0-9]+);/g, (m, d: string) => decodeCodePoint(parseInt(d, 10)) ?? m)
    .replace(/&#x([0-9a-fA-F]+);/g, (m, h: string) => decodeCodePoint(parseInt(h, 16)) ?? m)
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function decodeCodePoint(cp: number): string | undefined {
  if (!Number.isInteger(cp) || cp < 0 || cp > 0x10ffff) return undefined;
  if (cp >= 0xd800 && cp <= 0xdfff) return undefined;
  try {
    return String.fromCodePoint(cp);
  } catch {
    return undefined;
  }
}

function escapeXmlText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeXmlAttribute(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function createElementNode(nodeName: string, attributes: Record<string, string>): XmlNode {
  return {
    kind: 'element',
    nodeName,
    attributes,
    children: [],
    childNodes: [],
    textContent: '',
  };
}

function appendText(parent: XmlNode, value: string): void {
  if (value.length === 0) return;
  parent.childNodes!.push({ kind: 'text', nodeName: TEXT_NODE_NAME, attributes: Object.create(null), children: [], textContent: value, value });
  parent.textContent += value;
}

function parseAttributes(attrString: string): Record<string, string> {
  const attributes: Record<string, string> = Object.create(null);
  const attrRegex = /([a-zA-Z0-9_:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null;

  while ((match = attrRegex.exec(attrString)) !== null) {
    const key = match[1];
    const value = match[2] !== undefined ? match[2] : match[3] ?? '';
    if (key && key !== '__proto__' && key !== 'constructor' && key !== 'prototype') {
      attributes[key] = decodeXmlEntities(value);
    }
  }

  return attributes;
}

/**
 * Serializes a parsed node tree back to XML with strict lossless semantics:
 * pure structural concatenation — no added indentation or line breaks, so
 * `serialize(parse(x))` reproduces the source infoset and a second
 * parse/serialize cycle is byte-stable. Attribute order and document order
 * of mixed content are preserved; text is escaped minimally; comments are
 * re-emitted verbatim. The XML/DOCTYPE prolog is not part of the node tree —
 * callers prepend their own declaration.
 */
export function serializeXmlNode(node: XmlNode): string {
  if (node.kind === 'text') return escapeXmlText(node.value ?? '');
  if (node.kind === 'comment') return `<!--${node.value ?? ''}-->`;

  const attributeEntries = Object.entries(node.attributes);
  const attrString = attributeEntries
    .map(([key, value]) => ` ${key}="${escapeXmlAttribute(value)}"`)
    .join('');
  const childNodes = node.childNodes ?? node.children;

  if (childNodes.length === 0) {
    return `<${node.nodeName}${attrString}/>`;
  }

  return `<${node.nodeName}${attrString}>${childNodes.map((child) => serializeXmlNode(child)).join('')}</${node.nodeName}>`;
}

export class SimpleXmlAdapter implements XmlAdapter {
  parse(xmlString: string): XmlNode {
    // Strip XML declarations and DOCTYPE DTD declarations. CDATA sections are
    // inlined as escaped text *before* comment extraction so their content
    // survives verbatim (v2 N13). Comments are preserved as typed
    // '#comment' nodes so serialization stays lossless.
    let cleaned = xmlString
      .replace(/<\?xml[\s\S]*?\?>/g, '')
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_match, cdata: string) =>
        cdata.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      )
      .replace(/<!DOCTYPE[\s\S]*?>/gi, '');

    const root: XmlNode = {
      kind: 'element',
      nodeName: '__root__',
      attributes: Object.create(null),
      children: [],
      childNodes: [],
      textContent: '',
    };

    const stack: XmlNode[] = [root];
    // The attribute section must tolerate '>' inside quoted values (legal in
    // well-formed XML): match either a complete quoted string or any
    // non-quote, non-'>' character (v2 N13).
    const tagRegex = /<(\/)?([a-zA-Z0-9_:-]+)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/)?>|([^<]+)|<!--([\s\S]*?)-->/g;
    let match: RegExpExecArray | null;

    while ((match = tagRegex.exec(cleaned)) !== null) {
      const isClosing = Boolean(match[1]);
      const tagName = match[2];
      const rawAttrs = match[3] ?? '';
      const isSelfClosing = Boolean(match[4]);
      const text = match[5];
      const comment = match[6];

      const currentParent = stack[stack.length - 1];
      if (!currentParent) continue;

      if (comment !== undefined) {
        currentParent.childNodes!.push({
          kind: 'comment',
          nodeName: COMMENT_NODE_NAME,
          attributes: Object.create(null),
          children: [],
          textContent: comment,
          value: comment,
        });
      } else if (text !== undefined) {
        const decoded = decodeXmlEntities(text);
        appendText(currentParent, decoded);
      } else if (tagName) {
        if (isClosing) {
          if (stack.length > 1 && stack[stack.length - 1]?.nodeName === tagName) {
            stack.pop();
          }
        } else {
          const attributes = parseAttributes(rawAttrs);
          const newNode = createElementNode(tagName, attributes);
          currentParent.children.push(newNode);
          currentParent.childNodes!.push(newNode);

          if (!isSelfClosing) {
            stack.push(newNode);
          }
        }
      }
    }

    const firstElement = root.children[0];
    if (!firstElement) {
      throw new Error('Invalid XML: No root element found');
    }

    return firstElement;
  }
}

export const defaultXmlAdapter = new SimpleXmlAdapter();
