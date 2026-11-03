/**
 * Isomorphic XML reader and DOM-like node interface.
 * Decoupled from browser global DOM or Node.js-only packages.
 */

export interface XmlNode {
  nodeName: string;
  namespaceUri?: string;
  attributes: Record<string, string>;
  children: XmlNode[];
  textContent: string;
}

export interface XmlAdapter {
  parse(xmlString: string): XmlNode;
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
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

export class SimpleXmlAdapter implements XmlAdapter {
  parse(xmlString: string): XmlNode {
    // Strip XML declarations, DOCTYPE DTD declarations, and comments.
    // CDATA sections are inlined as escaped text *before* comment stripping
    // so their content survives verbatim and cannot be eaten by the comment
    // regex (v2 N13).
    let cleaned = xmlString
      .replace(/<\?xml[\s\S]*?\?>/g, '')
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_match, cdata: string) =>
        cdata.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      )
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<!DOCTYPE[\s\S]*?>/gi, '')
      .trim();

    const root: XmlNode = {
      nodeName: '__root__',
      attributes: Object.create(null),
      children: [],
      textContent: '',
    };

    const stack: XmlNode[] = [root];
    // The attribute section must tolerate '>' inside quoted values (legal in
    // well-formed XML): match either a complete quoted string or any
    // non-quote, non-'>' character (v2 N13).
    const tagRegex = /<(\/)?([a-zA-Z0-9_:-]+)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/)?>|([^<]+)/g;
    let match: RegExpExecArray | null;

    while ((match = tagRegex.exec(cleaned)) !== null) {
      const isClosing = Boolean(match[1]);
      const tagName = match[2];
      const rawAttrs = match[3] ?? '';
      const isSelfClosing = Boolean(match[4]);
      const text = match[5];

      const currentParent = stack[stack.length - 1];
      if (!currentParent) continue;

      if (text) {
        const trimmed = decodeXmlEntities(text);
        if (trimmed.length > 0) {
          currentParent.textContent += trimmed;
        }
      } else if (tagName) {
        if (isClosing) {
          if (stack.length > 1 && stack[stack.length - 1]?.nodeName === tagName) {
            stack.pop();
          }
        } else {
          const attributes = parseAttributes(rawAttrs);
          const newNode: XmlNode = {
            nodeName: tagName,
            attributes,
            children: [],
            textContent: '',
          };

          currentParent.children.push(newNode);

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
