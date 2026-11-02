import type { DrawingShapeNode, ParagraphNode, RunNode } from '../../types/ast.js';
import { parseDrawingNode } from '../dml/shape-parser.js';
import type { XmlNode } from '../xml-adapter.js';
import { parseParagraphProperties, parseRunProperties, type StyleResolver } from './style-resolver.js';

/**
 * Parser for w:p (paragraphs) and w:r (runs) into AST nodes.
 */

export interface ParagraphParser {
  parseParagraph(node: XmlNode, styleResolver?: StyleResolver): ParagraphNode;
  parseRun(node: XmlNode, inheritedStyle?: StyleResolver): RunNode;
}

export class StandardParagraphParser implements ParagraphParser {
  parseParagraph(node: XmlNode, styleResolver?: StyleResolver): ParagraphNode {
    let styleId: string | undefined;
    let directPPrNode: XmlNode | undefined;
    const runs: RunNode[] = [];

    for (const child of node.children) {
      const tag = child.nodeName.replace(/^[a-zA-Z0-9]+:/, '').toLowerCase();

      if (tag === 'ppr') {
        directPPrNode = child;
        const pStyle = child.children.find((c) => c.nodeName.toLowerCase().endsWith('pstyle'));
        if (pStyle) {
          styleId = pStyle.attributes['w:val'] ?? pStyle.attributes['val'];
        }
      } else if (tag === 'r') {
        runs.push(this.parseRun(child, styleResolver));
      } else if (tag === 'drawing' || tag === 'pict') {
        const parsedDrawing = parseDrawingNode(child);
        if (parsedDrawing) {
          runs.push({
            type: 'run',
            text: '',
            drawing: parsedDrawing,
          });
        }
      }
    }

    const baseStyle = styleResolver?.resolveParagraphStyle(styleId) ?? {};
    const directStyle = parseParagraphProperties(directPPrNode);
    const combinedStyle = { ...baseStyle, ...directStyle };

    return {
      type: 'paragraph',
      style: Object.keys(combinedStyle).length > 0 ? combinedStyle : undefined,
      children: runs,
    };
  }

  parseRun(node: XmlNode, styleResolver?: StyleResolver): RunNode {
    let directRPrNode: XmlNode | undefined;
    let rStyleId: string | undefined;
    let text = '';
    let drawing: DrawingShapeNode | undefined;

    for (const child of node.children) {
      const tag = child.nodeName.replace(/^[a-zA-Z0-9]+:/, '').toLowerCase();

      if (tag === 'rpr') {
        directRPrNode = child;
        const rStyle = child.children.find((c) => c.nodeName.toLowerCase().endsWith('rstyle'));
        if (rStyle) {
          rStyleId = rStyle.attributes['w:val'] ?? rStyle.attributes['val'];
        }
      } else if (tag === 't') {
        text += child.textContent;
      } else if (tag === 'br') {
        text += '\n';
      } else if (tag === 'tab') {
        text += '\t';
      } else if (tag === 'drawing' || tag === 'pict') {
        const parsedDrawing = parseDrawingNode(child);
        if (parsedDrawing) {
          drawing = parsedDrawing;
        }
      }
    }

    const baseStyle = styleResolver?.resolveRunStyle(rStyleId) ?? {};
    const directStyle = parseRunProperties(directRPrNode);
    const combinedStyle = { ...baseStyle, ...directStyle };

    return {
      type: 'run',
      text,
      style: Object.keys(combinedStyle).length > 0 ? combinedStyle : undefined,
      drawing,
    };
  }
}

export const defaultParagraphParser = new StandardParagraphParser();
