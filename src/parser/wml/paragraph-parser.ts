import type { DrawingShapeNode, ImageNode, ParagraphNode, RunNode } from '../../types/ast.js';
import { parseImageNode, type ImageResolver } from '../dml/image-parser.js';
import { parseDrawingNode } from '../dml/shape-parser.js';
import type { XmlNode } from '../xml-adapter.js';
import type { NumberingResolver } from './numbering-resolver.js';
import { parseParagraphProperties, parseRunProperties, type StyleResolver } from './style-resolver.js';

/**
 * Parser for w:p (paragraphs) and w:r (runs) into AST nodes.
 */

export interface ParagraphParser {
  parseParagraph(node: XmlNode, styleResolver?: StyleResolver, numberingResolver?: NumberingResolver, imageResolver?: ImageResolver): ParagraphNode;
  parseRun(node: XmlNode, inheritedStyle?: StyleResolver, imageResolver?: ImageResolver): RunNode;
}

export class StandardParagraphParser implements ParagraphParser {
  parseParagraph(node: XmlNode, styleResolver?: StyleResolver, numberingResolver?: NumberingResolver, imageResolver?: ImageResolver): ParagraphNode {
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
        runs.push(this.parseRun(child, styleResolver, imageResolver));
      } else if (tag === 'fldsimple') {
        const instr = (child.attributes['w:instr'] ?? child.attributes['instr'] ?? '').trim();
        const fieldType = instr.toUpperCase().startsWith('PAGE')
          ? 'PAGE'
          : instr.toUpperCase().startsWith('NUMPAGES')
            ? 'NUMPAGES'
            : instr;
        for (const fChild of child.children) {
          if (fChild.nodeName.replace(/^[a-zA-Z0-9]+:/, '').toLowerCase() === 'r') {
            const r = this.parseRun(fChild, styleResolver, imageResolver);
            r.field = fieldType;
            runs.push(r);
          }
        }
      } else if (tag === 'drawing' || tag === 'pict') {
        const parsedImage = parseImageNode(child, imageResolver);
        if (parsedImage) {
          runs.push({
            type: 'run',
            text: '',
            image: parsedImage,
          });
        } else {
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
    }

    const baseStyle = styleResolver?.resolveParagraphStyle(styleId) ?? {};
    const directStyle = parseParagraphProperties(directPPrNode);
    const combinedStyle = { ...baseStyle, ...directStyle };

    if (combinedStyle.numbering?.numId) {
      const resolved = numberingResolver?.resolveNumbering(
        combinedStyle.numbering.numId,
        combinedStyle.numbering.level,
      );
      if (resolved) {
        combinedStyle.numbering = {
          numId: resolved.numId,
          level: resolved.level,
          format: resolved.format,
          prefixText: resolved.prefixText,
        };
        if (resolved.indentLeftPt !== undefined && combinedStyle.indentLeftPt === undefined) {
          combinedStyle.indentLeftPt = resolved.indentLeftPt;
        }
        if (resolved.hangingPt !== undefined && combinedStyle.firstLineIndentPt === undefined) {
          combinedStyle.firstLineIndentPt = -resolved.hangingPt;
        }
      }
    }

    return {
      type: 'paragraph',
      style: Object.keys(combinedStyle).length > 0 ? combinedStyle : undefined,
      children: runs,
    };
  }

  parseRun(node: XmlNode, styleResolver?: StyleResolver, imageResolver?: ImageResolver): RunNode {
    let directRPrNode: XmlNode | undefined;
    let rStyleId: string | undefined;
    let text = '';
    let drawing: DrawingShapeNode | undefined;
    let image: ImageNode | undefined;
    let field: string | undefined;

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
      } else if (tag === 'instrtext') {
        const instr = child.textContent.trim().toUpperCase();
        if (instr.startsWith('PAGE')) {
          field = 'PAGE';
        } else if (instr.startsWith('NUMPAGES')) {
          field = 'NUMPAGES';
        } else {
          field = instr;
        }
      } else if (tag === 'br') {
        text += '\n';
      } else if (tag === 'tab') {
        text += '\t';
      } else if (tag === 'drawing' || tag === 'pict') {
        const parsedImage = parseImageNode(child, imageResolver);
        if (parsedImage) {
          image = parsedImage;
        } else {
          const parsedDrawing = parseDrawingNode(child);
          if (parsedDrawing) {
            drawing = parsedDrawing;
          }
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
      image,
      field,
    };
  }
}

export const defaultParagraphParser = new StandardParagraphParser();
