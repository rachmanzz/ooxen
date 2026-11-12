import type { BlockNode, DrawingShapeNode, ParagraphNode, VectorPathCommand } from '../../types/ast.js';
import type { XmlNode } from '../xml-adapter.js';
import { parseAnchorFromContainer, type ImageResolver } from './image-parser.js';
import type { NumberingResolver } from '../wml/numbering-resolver.js';
import type { HyperlinkResolver, ParagraphParser } from '../wml/paragraph-parser.js';
import type { StyleResolver } from '../wml/style-resolver.js';

const EMU_PER_POINT = 12700;

/** Local element name without namespace prefix, lowercased. */
function localName(nodeName: string): string {
  const colon = nodeName.lastIndexOf(':');
  return (colon >= 0 ? nodeName.slice(colon + 1) : nodeName).toLowerCase();
}

function parseEmu(val?: string): number {
  if (!val) return 0;
  const num = Number.parseFloat(val);
  return Number.isNaN(num) ? 0 : num / EMU_PER_POINT;
}

function parseHexColor(clrNode?: XmlNode): string | undefined {
  if (!clrNode) return undefined;
  const srgb = clrNode.children.find((c) => c.nodeName.toLowerCase().endsWith('srgbclr'));
  if (srgb) {
    const val = srgb.attributes['val'] ?? srgb.attributes['w:val'];
    if (val) return `#${val.replace(/^#/, '')}`;
  }
  return undefined;
}

/**
 * Reads width/height (in points) from a legacy VML `style` attribute, e.g.
 * `style="width:180pt;height:90pt"`. Falls back to 100×100 pt when the
 * attribute is absent — declared sizes must win over the fixed default (v1 F8).
 */
export function parseVmlSize(styleAttr?: string): { widthPt: number; heightPt: number } {
  const style = styleAttr ?? '';
  const widthMatch = style.match(/(?:^|;)\s*width\s*:\s*([\d.]+)\s*(pt|px)?/i);
  const heightMatch = style.match(/(?:^|;)\s*height\s*:\s*([\d.]+)\s*(pt|px)?/i);
  const toPt = (match: RegExpMatchArray | null): number => {
    if (!match) return 100;
    const num = Number.parseFloat(match[1]!);
    if (Number.isNaN(num)) return 100;
    return match[2]?.toLowerCase() === 'px' ? num * 0.75 : num;
  };
  return { widthPt: toPt(widthMatch), heightPt: toPt(heightMatch) };
}

/**
 * Generates vector path commands for standard preset DrawingML shapes.
 */
function isTruthyAttr(value: string | undefined): boolean {
  return value === '1' || value === 'true';
}

export function generatePresetGeometry(preset: string, widthPt: number, heightPt: number): VectorPathCommand[] {
  const w = Math.max(1, widthPt);
  // Height may be zero: a straight connector with zero xfrm height is a
  // truly horizontal line, not a 1pt-tall diagonal (F-CONNECTOR).
  const h = Math.max(0, heightPt);

  switch (preset.toLowerCase()) {
    case 'rect':
      return [
        { type: 'moveTo', points: [0, 0] },
        { type: 'lineTo', points: [w, 0] },
        { type: 'lineTo', points: [w, h] },
        { type: 'lineTo', points: [0, h] },
        { type: 'close', points: [] },
      ];

    case 'ellipse': {
      const rx = w / 2;
      const ry = h / 2;
      const cx = rx;
      const cy = ry;
      const kappa = 0.55228474983;
      const ox = rx * kappa;
      const oy = ry * kappa;

      return [
        { type: 'moveTo', points: [cx, 0] },
        { type: 'cubicBezTo', points: [cx + ox, 0, w, cy - oy, w, cy] },
        { type: 'cubicBezTo', points: [w, cy + oy, cx + ox, h, cx, h] },
        { type: 'cubicBezTo', points: [cx - ox, h, 0, cy + oy, 0, cy] },
        { type: 'cubicBezTo', points: [0, cy - oy, cx - ox, 0, cx, 0] },
        { type: 'close', points: [] },
      ];
    }

    case 'roundrect': {
      const r = Math.min(w, h) * 0.15;
      return [
        { type: 'moveTo', points: [r, 0] },
        { type: 'lineTo', points: [w - r, 0] },
        { type: 'quadBezTo', points: [w, 0, w, r] },
        { type: 'lineTo', points: [w, h - r] },
        { type: 'quadBezTo', points: [w, h, w - r, h] },
        { type: 'lineTo', points: [r, h] },
        { type: 'quadBezTo', points: [0, h, 0, h - r] },
        { type: 'lineTo', points: [0, r] },
        { type: 'quadBezTo', points: [0, 0, r, 0] },
        { type: 'close', points: [] },
      ];
    }

    case 'triangle':
      return [
        { type: 'moveTo', points: [w / 2, 0] },
        { type: 'lineTo', points: [w, h] },
        { type: 'lineTo', points: [0, h] },
        { type: 'close', points: [] },
      ];

    case 'diamond':
      return [
        { type: 'moveTo', points: [w / 2, 0] },
        { type: 'lineTo', points: [w, h / 2] },
        { type: 'lineTo', points: [w / 2, h] },
        { type: 'lineTo', points: [0, h / 2] },
        { type: 'close', points: [] },
      ];

    case 'line':
      return [
        { type: 'moveTo', points: [0, 0] },
        { type: 'lineTo', points: [w, h] },
      ];

    default:
      // Default fallback to rectangle
      return [
        { type: 'moveTo', points: [0, 0] },
        { type: 'lineTo', points: [w, 0] },
        { type: 'lineTo', points: [w, h] },
        { type: 'lineTo', points: [0, h] },
        { type: 'close', points: [] },
      ];
  }
}

/**
 * Parses SVG path d attribute string into VectorPathCommand[].
 */
export function parseSvgPathToCommands(d: string): VectorPathCommand[] {
  const commands: VectorPathCommand[] = [];
  const regex = /([a-df-z])([^a-df-z]*)/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(d)) !== null) {
    const cmd = match[1]!;
    const argsStr = match[2]?.trim() ?? '';
    const args = argsStr
      .split(/[\s,]+/)
      .filter((s) => s.length > 0)
      .map((s) => Number.parseFloat(s))
      .filter((n) => !Number.isNaN(n));

    switch (cmd.toUpperCase()) {
      case 'M':
        for (let i = 0; i < args.length; i += 2) {
          commands.push({
            type: i === 0 ? 'moveTo' : 'lineTo',
            points: [args[i] ?? 0, args[i + 1] ?? 0],
          });
        }
        break;
      case 'L':
        for (let i = 0; i < args.length; i += 2) {
          commands.push({
            type: 'lineTo',
            points: [args[i] ?? 0, args[i + 1] ?? 0],
          });
        }
        break;
      case 'C':
        for (let i = 0; i < args.length; i += 6) {
          commands.push({
            type: 'cubicBezTo',
            points: [
              args[i] ?? 0,
              args[i + 1] ?? 0,
              args[i + 2] ?? 0,
              args[i + 3] ?? 0,
              args[i + 4] ?? 0,
              args[i + 5] ?? 0,
            ],
          });
        }
        break;
      case 'Q':
        for (let i = 0; i < args.length; i += 4) {
          commands.push({
            type: 'quadBezTo',
            points: [
              args[i] ?? 0,
              args[i + 1] ?? 0,
              args[i + 2] ?? 0,
              args[i + 3] ?? 0,
            ],
          });
        }
        break;
      case 'Z':
        commands.push({ type: 'close', points: [] });
        break;
    }
  }

  return commands;
}

/**
 * Parses legacy VML path string into VectorPathCommand[].
 */
export function parseVmlPath(pathStr: string, widthPt: number, heightPt: number): VectorPathCommand[] {
  const commands: VectorPathCommand[] = [];
  const tokens = pathStr.trim().split(/[\s,]+/).filter((t) => t.length > 0);
  let i = 0;
  let currentCmd = '';

  while (i < tokens.length) {
    const token = tokens[i]!.toLowerCase();

    if (/^[a-z]$/.test(token)) {
      currentCmd = token;
      i++;
      if (token === 'x' || token === 'e') {
        if (!commands.some((c) => c.type === 'close')) {
          commands.push({ type: 'close', points: [] });
        }
      }
      continue;
    }

    if (currentCmd === 'm') {
      const x = Number.parseFloat(token);
      i++;
      const y = Number.parseFloat(tokens[i++] ?? '0');
      commands.push({ type: 'moveTo', points: [x, y] });
      currentCmd = 'l';
    } else if (currentCmd === 'l') {
      const x = Number.parseFloat(token);
      i++;
      const y = Number.parseFloat(tokens[i++] ?? '0');
      commands.push({ type: 'lineTo', points: [x, y] });
    } else if (currentCmd === 'c') {
      const cp1x = Number.parseFloat(token);
      i++;
      const cp1y = Number.parseFloat(tokens[i++] ?? '0');
      const cp2x = Number.parseFloat(tokens[i++] ?? '0');
      const cp2y = Number.parseFloat(tokens[i++] ?? '0');
      const x = Number.parseFloat(tokens[i++] ?? '0');
      const y = Number.parseFloat(tokens[i++] ?? '0');
      commands.push({
        type: 'cubicBezTo',
        points: [cp1x, cp1y, cp2x, cp2y, x, y],
      });
    } else {
      i++;
    }
  }

  return commands.length > 0 ? commands : generatePresetGeometry('rect', widthPt, heightPt);
}

/**
 * Parses custom geometry (<a:custGeom>) path list.
 */
function parseCustomGeometry(custGeomNode: XmlNode, widthPt: number, heightPt: number): VectorPathCommand[] {
  const pathLst = custGeomNode.children.find((c) => c.nodeName.toLowerCase().endsWith('pathlst'));
  if (!pathLst) return [];

  const pathNode = pathLst.children.find((c) => c.nodeName.toLowerCase().endsWith('path'));
  if (!pathNode) return [];

  const rawW = Number.parseFloat(pathNode.attributes['w'] ?? '0');
  const rawH = Number.parseFloat(pathNode.attributes['h'] ?? '0');

  const scaleX = rawW > 0 ? widthPt / rawW : 1;
  const scaleY = rawH > 0 ? heightPt / rawH : 1;

  const commands: VectorPathCommand[] = [];

  for (const cmdNode of pathNode.children) {
    const tag = cmdNode.nodeName.replace(/^[a-zA-Z0-9]+:/, '').toLowerCase();

    if (tag === 'moveto') {
      const pt = cmdNode.children.find((c) => c.nodeName.toLowerCase().endsWith('pt'));
      if (pt) {
        const x = Number.parseFloat(pt.attributes['x'] ?? '0') * scaleX;
        const y = Number.parseFloat(pt.attributes['y'] ?? '0') * scaleY;
        commands.push({ type: 'moveTo', points: [x, y] });
      }
    } else if (tag === 'lnto') {
      const pt = cmdNode.children.find((c) => c.nodeName.toLowerCase().endsWith('pt'));
      if (pt) {
        const x = Number.parseFloat(pt.attributes['x'] ?? '0') * scaleX;
        const y = Number.parseFloat(pt.attributes['y'] ?? '0') * scaleY;
        commands.push({ type: 'lineTo', points: [x, y] });
      }
    } else if (tag === 'cubicbezto') {
      const pts = cmdNode.children.filter((c) => c.nodeName.toLowerCase().endsWith('pt'));
      if (pts.length >= 3) {
        const cp1x = Number.parseFloat(pts[0]!.attributes['x'] ?? '0') * scaleX;
        const cp1y = Number.parseFloat(pts[0]!.attributes['y'] ?? '0') * scaleY;
        const cp2x = Number.parseFloat(pts[1]!.attributes['x'] ?? '0') * scaleX;
        const cp2y = Number.parseFloat(pts[1]!.attributes['y'] ?? '0') * scaleY;
        const endx = Number.parseFloat(pts[2]!.attributes['x'] ?? '0') * scaleX;
        const endy = Number.parseFloat(pts[2]!.attributes['y'] ?? '0') * scaleY;
        commands.push({
          type: 'cubicBezTo',
          points: [cp1x, cp1y, cp2x, cp2y, endx, endy],
        });
      }
    } else if (tag === 'quadbezto') {
      const pts = cmdNode.children.filter((c) => c.nodeName.toLowerCase().endsWith('pt'));
      if (pts.length >= 2) {
        const cpx = Number.parseFloat(pts[0]!.attributes['x'] ?? '0') * scaleX;
        const cpy = Number.parseFloat(pts[0]!.attributes['y'] ?? '0') * scaleY;
        const endx = Number.parseFloat(pts[1]!.attributes['x'] ?? '0') * scaleX;
        const endy = Number.parseFloat(pts[1]!.attributes['y'] ?? '0') * scaleY;
        commands.push({
          type: 'quadBezTo',
          points: [cpx, cpy, endx, endy],
        });
      }
    } else if (tag === 'close') {
      commands.push({ type: 'close', points: [] });
    }
  }

  return commands;
}

/**
 * Standard DrawingML / VML shape parser into Universal AST DrawingShapeNode.
 */
export function parseDrawingNode(node: XmlNode): DrawingShapeNode | undefined {
  const rootTag = node.nodeName.replace(/^[a-zA-Z0-9]+:/, '').toLowerCase();

  // 1. Handle DrawingML (<w:drawing>)
  if (rootTag === 'drawing') {
    const container = node.children.find((c) => {
      const tag = c.nodeName.toLowerCase();
      return tag.endsWith('inline') || tag.endsWith('anchor');
    });

    if (!container) return undefined;

    // Extent (dimensions)
    const extent = container.children.find((c) => c.nodeName.toLowerCase().endsWith('extent'));
    let widthPt = parseEmu(extent?.attributes['cx']);
    let heightPt = parseEmu(extent?.attributes['cy']);

    // DocPr (id and name)
    const docPr = container.children.find((c) => c.nodeName.toLowerCase().endsWith('docpr'));
    const id = docPr?.attributes['id'];
    const name = docPr?.attributes['name'];

    // Find shape properties inside graphicData. Match the exact local
    // name `spPr`: a suffix match would stop at `wps:cNvSpPr`, which
    // precedes the real `wps:spPr` and carries no fill or geometry.
    let spPr: XmlNode | undefined;
    for (const c of container.children) {
      if (localName(c.nodeName) === 'graphic') {
        const gData = c.children.find((gc) => localName(gc.nodeName) === 'graphicdata');
        if (gData) {
          const wsp = gData.children.find((wc) => {
            const t = localName(wc.nodeName);
            return t === 'wsp' || t === 'sp';
          });
          if (wsp) {
            spPr = wsp.children.find((sc) => localName(sc.nodeName) === 'sppr');
          } else {
            spPr = gData.children.find((sc) => localName(sc.nodeName) === 'sppr');
          }
        }
      }
    }

    if (!spPr) {
      // Shape property might be directly inside container in some variants
      spPr = container.children.find((sc) => localName(sc.nodeName) === 'sppr');
    }

    // Fallback dimensions from xfrm
    if ((widthPt === 0 || heightPt === 0) && spPr) {
      const xfrm = spPr.children.find((c) => c.nodeName.toLowerCase().endsWith('xfrm'));
      const ext = xfrm?.children.find((c) => c.nodeName.toLowerCase().endsWith('ext'));
      if (ext) {
        widthPt = widthPt || parseEmu(ext.attributes['cx']);
        heightPt = heightPt || parseEmu(ext.attributes['cy']);
      }
    }

    const prstGeom = spPr?.children.find((c) => c.nodeName.toLowerCase().endsWith('prstgeom'));
    const prst = prstGeom?.attributes['prst'] ?? 'rect';
    const isConnector = prst.toLowerCase().startsWith('straightconnector');
    const ln = spPr?.children.find((c) => c.nodeName.toLowerCase().endsWith('ln'));

    // Defaults if missing. A straight connector with a zero extent is a
    // real horizontal/vertical line (Word writes cy="0"): its box is only
    // as thick as its stroke, never the 100pt placeholder (F-CONNECTOR).
    if (isConnector) {
      const thickness = Math.max(0.75, parseEmu(ln?.attributes['w']) || 1);
      if (widthPt === 0) widthPt = thickness;
      if (heightPt === 0) heightPt = thickness;
    } else {
      if (widthPt === 0) widthPt = 100;
      if (heightPt === 0) heightPt = 100;
    }

    // Fill
    let fill: string | undefined;
    const solidFill = spPr?.children.find((c) => c.nodeName.toLowerCase().endsWith('solidfill'));
    if (solidFill) {
      fill = parseHexColor(solidFill);
    }

    // Stroke (<a:noFill/> means no outline, not a default black stroke)
    let stroke: { color: string; widthPt: number } | undefined;
    if (ln && !ln.children.some((c) => c.nodeName.toLowerCase().endsWith('nofill'))) {
      const lnW = parseEmu(ln.attributes['w']) || 1;
      const lnSolidFill = ln.children.find((c) => c.nodeName.toLowerCase().endsWith('solidfill'));
      const strokeClr = parseHexColor(lnSolidFill) ?? '#000000';
      stroke = { color: strokeClr, widthPt: lnW };
    } else if (!ln && isConnector) {
      // Word omits a:ln on default-formatted connectors and takes the
      // outline from wps:style/a:lnRef (theme line, 0.75pt black). A
      // connector is nothing but its outline, so it needs that default
      // or it vanishes (F-CONNECTOR).
      stroke = { color: '#000000', widthPt: 0.75 };
    }

    // Geometry (straight connectors are lines, not boxes)
    let commands: VectorPathCommand[] = [];
    const custGeom = spPr?.children.find((c) => c.nodeName.toLowerCase().endsWith('custgeom'));
    if (custGeom) {
      commands = parseCustomGeometry(custGeom, widthPt, heightPt);
    } else {
      let geoW = widthPt;
      let geoH = heightPt;
      let flipH = false;
      let flipV = false;
      if (isConnector) {
        // Connectors draw in xfrm space: a zero cy means a truly
        // horizontal 1pt line, not a 1pt-tall diagonal (F-CONNECTOR).
        const xfrm = spPr?.children.find((c) => c.nodeName.toLowerCase().endsWith('xfrm'));
        const ext = xfrm?.children.find((c) => c.nodeName.toLowerCase().endsWith('ext'));
        if (ext) {
          geoW = parseEmu(ext.attributes['cx']) || geoW;
          geoH = parseEmu(ext.attributes['cy']);
        }
        flipH = isTruthyAttr(xfrm?.attributes['flipH']);
        flipV = isTruthyAttr(xfrm?.attributes['flipV']);
      }
      commands = generatePresetGeometry(isConnector ? 'line' : prst, geoW, geoH);
      if (flipH || flipV) {
        // The preset line runs top-left to bottom-right; a:xfrm flips
        // mirror it inside its own box (bottom-left to top-right, ...).
        commands = commands.map((cmd) => ({
          ...cmd,
          points: cmd.points.map((v, i) => (i % 2 === 0 ? (flipH ? geoW - v : v) : flipV ? geoH - v : v)),
        }));
      }
    }

    // Floating placement (wp:anchor): resolved by the layout engine like images.
    const anchor = parseAnchorFromContainer(container);

    return {
      type: 'drawing',
      id,
      name,
      widthPt,
      heightPt,
      commands,
      fill,
      stroke,
      anchor,
    };
  }

  // 2. Handle legacy VML (<w:pict>)
  if (rootTag === 'pict') {
    const shape = node.children.find((c) => c.nodeName.toLowerCase().endsWith('shape'));
    if (!shape) return undefined;

    const pathStr = shape.attributes['path'];
    const fillcolor = shape.attributes['fillcolor'];
    const strokecolor = shape.attributes['strokecolor'];
    const strokeweight = shape.attributes['strokeweight'];

    const { widthPt, heightPt } = parseVmlSize(shape.attributes['style']);

    const commands = pathStr ? parseVmlPath(pathStr, widthPt, heightPt) : generatePresetGeometry('rect', widthPt, heightPt);

    return {
      type: 'drawing',
      id: shape.attributes['id'],
      widthPt,
      heightPt,
      commands,
      fill: fillcolor,
      stroke: strokecolor ? { color: strokecolor, widthPt: strokeweight ? Number.parseFloat(strokeweight) : 1 } : undefined,
    };
  }

  return undefined;
}

/**
 * Extracts WordProcessingShape textboxes (`wps:wsp` → `wps:txbx` →
 * `w:txbxContent`) as ordinary paragraphs.
 *
 * Floating shapes are the standard Word construct for banners, journal
 * headers, and callouts; without this their text silently vanishes from
 * the AST (the MCE Choice branch legitimately wins over the raster
 * Fallback, so the content must be honored, not dropped).
 *
 * Returns undefined when the drawing holds no textbox. Shape geometry and
 * fill are intentionally not mapped yet — paragraphs render in-flow with
 * their authored run formatting.
 */
export function parseTextboxBlocks(
  node: XmlNode,
  paragraphParser: ParagraphParser,
  styleResolver?: StyleResolver,
  numberingResolver?: NumberingResolver,
  imageResolver?: ImageResolver,
  hyperlinkResolver?: HyperlinkResolver,
): BlockNode[] | undefined {
  const rootTag = node.nodeName.replace(/^[a-zA-Z0-9]+:/, '').toLowerCase();
  if (rootTag !== 'drawing') return undefined;

  const container = node.children.find((c) => {
    const tag = c.nodeName.toLowerCase();
    return tag.endsWith('inline') || tag.endsWith('anchor');
  });
  if (!container) return undefined;

  const blocks: ParagraphNode[] = [];
  for (const c of container.children) {
    if (!c.nodeName.toLowerCase().endsWith('graphic')) continue;
    const gData = c.children.find((gc) => gc.nodeName.toLowerCase().endsWith('graphicdata'));
    if (!gData) continue;
    const wsp = gData.children.find((wc) => wc.nodeName.toLowerCase().endsWith('wsp'));
    if (!wsp) continue;
    const txbx = wsp.children.find((wc) => wc.nodeName.toLowerCase().endsWith('txbx'));
    if (!txbx) continue;
    const content = txbx.children.find((tc) => tc.nodeName.toLowerCase().endsWith('txbxcontent'));
    if (!content) continue;
    for (const p of content.children) {
      if (!p.nodeName.toLowerCase().endsWith('p')) continue;
      blocks.push(
        paragraphParser.parseParagraph(p, styleResolver, numberingResolver, imageResolver, hyperlinkResolver),
      );
    }
  }

  return blocks.length > 0 ? blocks : undefined;
}
