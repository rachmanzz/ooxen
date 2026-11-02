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
