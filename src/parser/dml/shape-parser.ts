import type { DrawingShapeNode, VectorPathCommand } from '../../types/ast.js';
import type { XmlNode } from '../xml-adapter.js';

const EMU_PER_POINT = 12700;

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
 * Generates vector path commands for standard preset DrawingML shapes.
 */
export function generatePresetGeometry(preset: string, widthPt: number, heightPt: number): VectorPathCommand[] {
  const w = Math.max(1, widthPt);
  const h = Math.max(1, heightPt);

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

    // Find shape properties inside graphicData
    let spPr: XmlNode | undefined;
    for (const c of container.children) {
      if (c.nodeName.toLowerCase().endsWith('graphic')) {
        const gData = c.children.find((gc) => gc.nodeName.toLowerCase().endsWith('graphicdata'));
        if (gData) {
          const wsp = gData.children.find((wc) => {
            const t = wc.nodeName.toLowerCase();
            return t.endsWith('wsp') || t.endsWith('sp');
          });
          if (wsp) {
            spPr = wsp.children.find((sc) => sc.nodeName.toLowerCase().endsWith('sppr'));
          } else {
            spPr = gData.children.find((sc) => sc.nodeName.toLowerCase().endsWith('sppr'));
          }
        }
      }
    }

    if (!spPr) {
      // Shape property might be directly inside container in some variants
      spPr = container.children.find((sc) => sc.nodeName.toLowerCase().endsWith('sppr'));
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

    // Defaults if missing
    if (widthPt === 0) widthPt = 100;
    if (heightPt === 0) heightPt = 100;

    // Fill
    let fill: string | undefined;
    const solidFill = spPr?.children.find((c) => c.nodeName.toLowerCase().endsWith('solidfill'));
    if (solidFill) {
      fill = parseHexColor(solidFill);
    }

    // Stroke
    let stroke: { color: string; widthPt: number } | undefined;
    const ln = spPr?.children.find((c) => c.nodeName.toLowerCase().endsWith('ln'));
    if (ln) {
      const lnW = parseEmu(ln.attributes['w']) || 1;
      const lnSolidFill = ln.children.find((c) => c.nodeName.toLowerCase().endsWith('solidfill'));
      const strokeClr = parseHexColor(lnSolidFill) ?? '#000000';
      stroke = { color: strokeClr, widthPt: lnW };
    }

    // Geometry
    let commands: VectorPathCommand[] = [];
    const custGeom = spPr?.children.find((c) => c.nodeName.toLowerCase().endsWith('custgeom'));
    if (custGeom) {
      commands = parseCustomGeometry(custGeom, widthPt, heightPt);
    } else {
      const prstGeom = spPr?.children.find((c) => c.nodeName.toLowerCase().endsWith('prstgeom'));
      const prst = prstGeom?.attributes['prst'] ?? 'rect';
      commands = generatePresetGeometry(prst, widthPt, heightPt);
    }

    return {
      type: 'drawing',
      id,
      name,
      widthPt,
      heightPt,
      commands,
      fill,
      stroke,
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

    const widthPt = 100;
    const heightPt = 100;

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
