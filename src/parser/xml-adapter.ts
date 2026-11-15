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

/** Local element name without namespace prefix, lowercased (`w:p` -> `p`). */
export function localName(nodeName: string): string {
  const colon = nodeName.lastIndexOf(':');
  return (colon >= 0 ? nodeName.slice(colon + 1) : nodeName).toLowerCase();
}

const NAMED_ENTITIES: Record<string, string> = { quot: '"', apos: "'", lt: '<', gt: '>', amp: '&' };

function decodeXmlEntities(text: string): string {
  // One pass over every reference form (F-PENT-REF): sequential passes
  // let the output of one reference join the input of the next, so
  // &amp;#65; or &#38;lt; would double-decode.
  return text.replace(/&(?:#([0-9]+)|#x([0-9a-fA-F]+)|(quot|apos|lt|gt|amp));/g, (m, dec: string | undefined, hex: string | undefined, name: string | undefined) => {
    if (dec !== undefined) return decodeCodePoint(parseInt(dec, 10));
    if (hex !== undefined) return decodeCodePoint(parseInt(hex, 16));
    return name !== undefined ? (NAMED_ENTITIES[name] ?? m) : m;
  });
}

/**
 * XML 1.0 §2.2 Char: a reference to NUL, a C0 control other than
 * tab/LF/CR, a surrogate, U+FFFE/U+FFFF, or anything past U+10FFFF is
 * not a character. It becomes U+FFFD so the AST never holds a code point
 * the writer cannot re-serialize, and the reference itself never turns
 * into visible text on round-trip (F-PENT-CHAR).
 */
function decodeCodePoint(cp: number): string {
  if (!Number.isInteger(cp) || cp < 0 || cp > 0x10ffff) return '\uFFFD';
  if (cp >= 0xd800 && cp <= 0xdfff) return '\uFFFD';
  if (cp < 0x20 && cp !== 0x09 && cp !== 0x0a && cp !== 0x0d) return '\uFFFD';
  if (cp === 0xfffe || cp === 0xffff) return '\uFFFD';
  return String.fromCodePoint(cp);
}

/**
 * Escapes text for either element content or a quoted attribute: all
 * five XML predefined entities. One escaper for every emitter that
 * builds markup from strings (WML/OPC serializers, HTML, SVG) so
 * coverage cannot drift between copies. The node serializer below keeps
 * its own minimal text/attribute escapers on purpose: it is lossless and
 * must reproduce the source infoset byte for byte.
 */
export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * ST_OnOff attribute value (ISO/IEC 29500-1 §22.9.2.7): `1`, `true`, `on`
 * are true; `0`, `false`, `off` are false. Absent or invalid values
 * (including the empty string) return undefined so the caller applies the
 * schema default. One reading for every on/off attribute.
 */
export function parseOnOff(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  const v = value.trim().toLowerCase();
  if (v === '1' || v === 'true' || v === 'on') return true;
  if (v === '0' || v === 'false' || v === 'off') return false;
  return undefined;
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
