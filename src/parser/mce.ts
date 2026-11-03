/**
 * ISO/IEC 29500-3 Markup Compatibility and Extensibility (MCE) resolution.
 *
 * Word documents routinely wrap content in `mc:AlternateContent` — a
 * `mc:Choice` per consumer capability plus a `mc:Fallback`. Before this
 * module, such content was silently skipped by every parser (no tag matched).
 * Resolution happens once, right after XML parsing, so all downstream
 * parsers see the resolved tree as if the wrapper never existed.
 */

import type { XmlNode } from './xml-adapter.js';

export const MCE_NAMESPACE = 'http://schemas.openxmlformats.org/markup-compatibility/2006';

/**
 * Namespaces Ooxen can actually interpret. A `mc:Choice` is selected only
 * when every prefix in its `Requires` attribute maps to one of these;
 * otherwise the `mc:Fallback` branch is used — matching how Word treats
 * older consumers.
 */
export const SUPPORTED_MARKUP_NAMESPACES: readonly string[] = [
  MCE_NAMESPACE,
  'http://schemas.openxmlformats.org/wordprocessingml/2006/main', // w
  'http://purl.oclc.org/ooxml/wordprocessingml/main', // w (strict alias)
  'http://schemas.openxmlformats.org/drawingml/2006/main', // a
  'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing', // wp
  'http://schemas.openxmlformats.org/drawingml/2006/picture', // pic
  'http://schemas.microsoft.com/office/word/2010/wordprocessingShape', // wps
  'http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas', // wpc
  'http://schemas.microsoft.com/office/word/2010/wordprocessingGroup', // wpg
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships', // r
  'http://schemas.openxmlformats.org/officeDocument/2006/math', // m
  'urn:schemas-microsoft-com:vml', // v
];

function localName(nodeName: string): string {
  return nodeName.replace(/^[a-zA-Z0-9]+:/, '').toLowerCase();
}

function isMceElement(node: XmlNode, nsByPrefix: Map<string, string>, local: string): boolean {
  const colonIndex = node.nodeName.indexOf(':');
  if (colonIndex === -1) return false; // unprefixed elements are not in the mc namespace
  const uri = nsByPrefix.get(node.nodeName.slice(0, colonIndex));
  return uri === MCE_NAMESPACE && localName(node.nodeName) === local;
}

function collectXmlnsDeclarations(node: XmlNode, nsByPrefix: Map<string, string>): void {
  for (const [key, value] of Object.entries(node.attributes)) {
    if (key === 'xmlns') nsByPrefix.set('', value);
    else if (key.startsWith('xmlns:')) nsByPrefix.set(key.slice(6), value);
  }
  for (const child of node.children) collectXmlnsDeclarations(child, nsByPrefix);
}

function choiceIsSupported(choice: XmlNode, nsByPrefix: Map<string, string>): boolean {
  const requires = choice.attributes['Requires'] ?? choice.attributes['requires'] ?? '';
  const prefixes = requires.trim().split(/\s+/).filter(Boolean);
  if (prefixes.length === 0) return false;
  return prefixes.every((prefix) => {
    const uri = nsByPrefix.get(prefix);
    return uri !== undefined && SUPPORTED_MARKUP_NAMESPACES.includes(uri);
  });
}

/**
 * Resolves every mc:AlternateContent in the tree in place: the first
 * supported mc:Choice branch (or the mc:Fallback branch) replaces the
 * wrapper at its original position. Nested AlternateContent inside a chosen
 * branch is resolved recursively.
 */
export function resolveMarkupCompatibility(root: XmlNode): XmlNode {
  const nsByPrefix = new Map<string, string>();
  collectXmlnsDeclarations(root, nsByPrefix);
  resolveAlternateContent(root, nsByPrefix);
  return root;
}

function resolveAlternateContent(node: XmlNode, nsByPrefix: Map<string, string>): void {
  const children = node.children;
  for (let i = 0; i < children.length; ) {
    const child = children[i]!;

    if (isMceElement(child, nsByPrefix, 'alternatecontent')) {
      const chosen = selectBranch(child, nsByPrefix);
      // Resolve nested AlternateContent before splicing.
      const branchNode: XmlNode = { ...child, children: chosen, childNodes: chosen };
      resolveAlternateContent(branchNode, nsByPrefix);

      const removeCount = 1;
      children.splice(i, removeCount, ...branchNode.children);
      if (node.childNodes) {
        const index = node.childNodes.indexOf(child);
        if (index >= 0) node.childNodes.splice(index, removeCount, ...branchNode.children);
      }
      continue; // re-examine the spliced position
    }

    resolveAlternateContent(child, nsByPrefix);
    i++;
  }
}

function selectBranch(alternateContent: XmlNode, nsByPrefix: Map<string, string>): XmlNode[] {
  let fallbackChildren: XmlNode[] | undefined;

  for (const branch of alternateContent.children) {
    if (isMceElement(branch, nsByPrefix, 'choice')) {
      // First supported Choice wins; keep scanning for a later Fallback.
      if (choiceIsSupported(branch, nsByPrefix)) return branch.children;
    } else if (isMceElement(branch, nsByPrefix, 'fallback') && !fallbackChildren) {
      fallbackChildren = branch.children;
    }
    // Any other child element is ignored (AlternateContent admits only
    // Choice/Fallback branches).
  }

  return fallbackChildren ?? [];
}

/** Cheap pre-check so the tree walk is skipped for parts without MCE markup. */
export function hasMarkupCompatibility(xml: string): boolean {
  return xml.includes('AlternateContent') || xml.includes('Ignorable');
}

/**
 * Parse + resolve in one step: the standard entry point for every part of a
 * WordprocessingML package.
 */
export function parseWithMarkupCompatibility(xml: string, parse: (xml: string) => XmlNode): XmlNode {
  const root = parse(xml);
  return hasMarkupCompatibility(xml) ? resolveMarkupCompatibility(root) : root;
}
