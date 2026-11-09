import type { ImageAnchor, ImageNode } from '../../types/ast.js';
import { emuToPt, uint8ArrayToBase64 } from '../../types/common.js';
import { parseVmlSize } from './shape-parser.js';
import type { XmlNode } from '../xml-adapter.js';

/**
 * Guesses standard MIME type from a file name or extension.
 */
export function guessMimeType(pathOrExt: string): string {
  const ext = pathOrExt.replace(/^.*\./, '').toLowerCase();
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'svg':
      return 'image/svg+xml';
    default:
      return 'application/octet-stream';
  }
}

export interface ImageResolver {
  resolveImage(relationshipId: string): { data?: Uint8Array; src?: string; mimeType?: string } | undefined;
}

/**
 * Reads floating placement (`wp:anchor` positionH/positionV) from an
 * inline-or-anchor drawing container. Returns undefined for `wp:inline`
 * containers, which stay in the text flow. Shared by images and shapes
 * so both overlay at their authored position (F-ANCHOR).
 */
export function parseAnchorFromContainer(container: XmlNode): ImageAnchor | undefined {
  if (!container.nodeName.toLowerCase().endsWith('anchor')) return undefined;
  const posH = container.children.find((c) => c.nodeName.toLowerCase().endsWith('positionh'));
  const posV = container.children.find((c) => c.nodeName.toLowerCase().endsWith('positionv'));
  const offH = posH?.children.find((c) => c.nodeName.toLowerCase().endsWith('posoffset'));
  const offV = posV?.children.find((c) => c.nodeName.toLowerCase().endsWith('posoffset'));
  // Align-based positioning (F-ANCHOR): w:align replaces w:posOffset.
  const alignH = posH?.children.find((c) => c.nodeName.toLowerCase().endsWith('align'))?.textContent.trim().toLowerCase();
  const alignV = posV?.children.find((c) => c.nodeName.toLowerCase().endsWith('align'))?.textContent.trim().toLowerCase();
  return {
    horizontalFrom: posH?.attributes['relativeFrom'] ?? posH?.attributes['relativefrom'] ?? 'column',
    horizontalOffsetPt: emuToPt(Number.parseFloat(offH?.textContent ?? '0') || 0),
    horizontalAlign: offH ? undefined : alignH || undefined,
    verticalFrom: posV?.attributes['relativeFrom'] ?? posV?.attributes['relativefrom'] ?? 'paragraph',
    verticalOffsetPt: emuToPt(Number.parseFloat(offV?.textContent ?? '0') || 0),
    verticalAlign: offV ? undefined : alignV || undefined,
    behindDoc: container.attributes['behindDoc'] === '1' || container.attributes['behinddoc'] === '1',
  };
}

/**
 * Parses DrawingML <pic:pic> or VML <v:imagedata> into Universal AST ImageNode.
 */
export function parseImageNode(node: XmlNode, imageResolver?: ImageResolver): ImageNode | undefined {
  const rootTag = node.nodeName.replace(/^[a-zA-Z0-9]+:/, '').toLowerCase();

  // 1. DrawingML (<w:drawing>)
  if (rootTag === 'drawing') {
    const container = node.children.find((c) => {
      const tag = c.nodeName.toLowerCase();
      return tag.endsWith('inline') || tag.endsWith('anchor');
    });

    if (!container) return undefined;

    // Extent (dimensions in EMU)
    const extent = container.children.find((c) => c.nodeName.toLowerCase().endsWith('extent'));
    const cx = Number.parseFloat(extent?.attributes['cx'] ?? '0');
    const cy = Number.parseFloat(extent?.attributes['cy'] ?? '0');
    let widthPt = cx > 0 ? emuToPt(cx) : 100;
    let heightPt = cy > 0 ? emuToPt(cy) : 100;

    // Floating placement (wp:anchor positionH/positionV). Inline images
    // carry no anchor and stay in the text flow.
    const anchor = parseAnchorFromContainer(container);

    // DocPr (metadata)
    const docPr = container.children.find((c) => c.nodeName.toLowerCase().endsWith('docpr'));
    const id = docPr?.attributes['id'];
    const name = docPr?.attributes['name'];
    const altText = docPr?.attributes['descr'] ?? docPr?.attributes['title'];

    // Find pic:pic element
    let picNode: XmlNode | undefined;
    for (const c of container.children) {
      if (c.nodeName.toLowerCase().endsWith('graphic')) {
        const gData = c.children.find((gc) => gc.nodeName.toLowerCase().endsWith('graphicdata'));
        if (gData) {
          picNode = gData.children.find((pc) => pc.nodeName.toLowerCase().endsWith('pic'));
        }
      }
    }

    if (!picNode) return undefined;

    // Find blip and relationshipId
    const blipFill = picNode.children.find((c) => c.nodeName.toLowerCase().endsWith('blipfill'));
    const blip = blipFill?.children.find((c) => c.nodeName.toLowerCase().endsWith('blip'));
    const relId = blip?.attributes['r:embed'] ?? blip?.attributes['embed'] ?? blip?.attributes['r:link'];

    if (!relId) return undefined;

    // Resolve binary data if resolver provided
    let data: Uint8Array | undefined;
    let src: string | undefined;
    let mimeType: string | undefined;

    if (imageResolver) {
      const resolved = imageResolver.resolveImage(relId);
      if (resolved) {
        data = resolved.data;
        src = resolved.src;
        mimeType = resolved.mimeType;

        if (!src && data && mimeType) {
          src = `data:${mimeType};base64,${uint8ArrayToBase64(data)}`;
        }
      }
    }

    return {
      type: 'image',
      id,
      name,
      altText,
      widthPt,
      heightPt,
      relationshipId: relId,
      data,
      src,
      mimeType,
      anchor,
    };
  }

  // 2. Legacy VML (<w:pict>)
  if (rootTag === 'pict') {
    // Imagedata hosts are not limited to v:shape — v:rect/v:oval/
    // v:roundrect/etc. carry it the same way (F-VMLSDT).
    const shape = node.children.find((c) => c.nodeName.toLowerCase().endsWith('shape')) ??
      node.children.find((c) =>
        c.children.some((g) => g.nodeName.toLowerCase().endsWith('imagedata')),
      );
    const imagedata = shape?.children.find((c) => c.nodeName.toLowerCase().endsWith('imagedata')) ??
                      node.children.find((c) => c.nodeName.toLowerCase().endsWith('imagedata'));

    if (!imagedata) return undefined;

    const relId = imagedata.attributes['r:id'] ?? imagedata.attributes['id'];
    if (!relId) return undefined;

    const altText = imagedata.attributes['o:title'] ?? shape?.attributes['alt'];
    const { widthPt, heightPt } = parseVmlSize(shape?.attributes['style']);

    let data: Uint8Array | undefined;
    let src: string | undefined;
    let mimeType: string | undefined;

    if (imageResolver) {
      const resolved = imageResolver.resolveImage(relId);
      if (resolved) {
        data = resolved.data;
        src = resolved.src;
        mimeType = resolved.mimeType;
        if (!src && data && mimeType) {
          src = `data:${mimeType};base64,${uint8ArrayToBase64(data)}`;
        }
      }
    }

    return {
      type: 'image',
      id: shape?.attributes['id'],
      altText,
      widthPt,
      heightPt,
      relationshipId: relId,
      data,
      src,
      mimeType,
    };
  }

  return undefined;
}
