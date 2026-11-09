import { describe, expect, it } from 'bun:test';
import { generatePresetGeometry, parseDrawingNode, parseSvgPathToCommands } from '../../src/parser/dml/shape-parser.js';
import { defaultXmlAdapter } from '../../src/parser/xml-adapter.js';

describe('DrawingML & Vector Shape Parser', () => {
  it('should parse custom geometry DrawingML shape', () => {
    const xml = `
      <w:drawing xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
                 xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
                 xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
                 xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">
        <wp:inline>
          <wp:extent cx="1270000" cy="635000"/>
          <wp:docPr id="101" name="CustomVectorPath"/>
          <a:graphic>
            <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">
              <wps:wsp>
                <wps:spPr>
                  <a:custGeom>
                    <a:pathLst>
                      <a:path w="100" h="50">
                        <a:moveTo><a:pt x="0" y="0"/></a:moveTo>
                        <a:lnTo><a:pt x="100" y="0"/></a:lnTo>
                        <a:cubicBezTo>
                          <a:pt x="100" y="25"/>
                          <a:pt x="50" y="50"/>
                          <a:pt x="0" y="50"/>
                        </a:cubicBezTo>
                        <a:close/>
                      </a:path>
                    </a:pathLst>
                  </a:custGeom>
                  <a:solidFill>
                    <a:srgbClr val="FF0000"/>
                  </a:solidFill>
                  <a:ln w="25400">
                    <a:solidFill>
                      <a:srgbClr val="003366"/>
                    </a:solidFill>
                  </a:ln>
                </wps:spPr>
              </wps:wsp>
            </a:graphicData>
          </a:graphic>
        </wp:inline>
      </w:drawing>
    `;

    const root = defaultXmlAdapter.parse(xml);
    const shape = parseDrawingNode(root);

    expect(shape).toBeDefined();
    expect(shape?.type).toBe('drawing');
    expect(shape?.id).toBe('101');
    expect(shape?.name).toBe('CustomVectorPath');
    expect(shape?.widthPt).toBe(100); // 1270000 / 12700
    expect(shape?.heightPt).toBe(50); // 635000 / 12700
    expect(shape?.fill).toBe('#FF0000');
    expect(shape?.stroke?.color).toBe('#003366');
    expect(shape?.stroke?.widthPt).toBe(2); // 25400 / 12700

    expect(shape?.commands.length).toBe(4);
    expect(shape?.commands[0]?.type).toBe('moveTo');
    expect(shape?.commands[0]?.points).toEqual([0, 0]);
    expect(shape?.commands[1]?.type).toBe('lineTo');
    expect(shape?.commands[1]?.points).toEqual([100, 0]);
    expect(shape?.commands[2]?.type).toBe('cubicBezTo');
    expect(shape?.commands[2]?.points).toEqual([100, 25, 50, 50, 0, 50]);
    expect(shape?.commands[3]?.type).toBe('close');
  });

  it('should parse preset geometry DrawingML shape (rect, ellipse, triangle)', () => {
    const xml = `
      <w:drawing xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
                 xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
                 xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <wp:inline>
          <wp:extent cx="1270000" cy="1270000"/>
          <a:graphic>
            <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">
              <a:spPr>
                <a:prstGeom prst="ellipse"/>
                <a:solidFill><a:srgbClr val="00AAFF"/></a:solidFill>
              </a:spPr>
            </a:graphicData>
          </a:graphic>
        </wp:inline>
      </w:drawing>
    `;

    const root = defaultXmlAdapter.parse(xml);
    const shape = parseDrawingNode(root);

    expect(shape).toBeDefined();
    expect(shape?.widthPt).toBe(100);
    expect(shape?.heightPt).toBe(100);
    expect(shape?.fill).toBe('#00AAFF');
    expect(shape?.commands.length).toBe(6); // moveTo + 4 cubic curves + close
  });

  it('should parse legacy VML shape', () => {
    const xml = `
      <w:pict xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
              xmlns:v="urn:schemas-microsoft-com:vml">
        <v:shape id="vmlShape1"
                 fillcolor="#00FF00"
                 strokecolor="#000000"
                 strokeweight="1.5pt"
                 path="m 0,0 l 100,0, 100,100, 0,100 x e"/>
      </w:pict>
    `;

    const root = defaultXmlAdapter.parse(xml);
    const shape = parseDrawingNode(root);

    expect(shape).toBeDefined();
    expect(shape?.id).toBe('vmlShape1');
    expect(shape?.fill).toBe('#00FF00');
    expect(shape?.stroke?.color).toBe('#000000');
    expect(shape?.stroke?.widthPt).toBe(1.5);
    expect(shape?.commands.length).toBe(5);
  });

  it('should parse SVG path string to vector commands', () => {
    const d = 'M 10 20 L 50 60 C 70 80 90 100 110 120 Z';
    const commands = parseSvgPathToCommands(d);

    expect(commands.length).toBe(4);
    expect(commands[0]).toEqual({ type: 'moveTo', points: [10, 20] });
    expect(commands[1]).toEqual({ type: 'lineTo', points: [50, 60] });
    expect(commands[2]).toEqual({ type: 'cubicBezTo', points: [70, 80, 90, 100, 110, 120] });
    expect(commands[3]).toEqual({ type: 'close', points: [] });
  });

  it('finds wps:spPr even when wps:cNvSpPr precedes it', () => {
    const xml = `
      <w:drawing xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
                 xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
                 xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
                 xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">
        <wp:anchor>
          <wp:extent cx="4839970" cy="907415"/>
          <wp:docPr id="311" name=""/>
          <wp:positionH relativeFrom="column"><wp:posOffset>76201</wp:posOffset></wp:positionH>
          <wp:positionV relativeFrom="paragraph"><wp:posOffset>-12699</wp:posOffset></wp:positionV>
          <a:graphic>
            <a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">
              <wps:wsp>
                <wps:cNvSpPr/>
                <wps:cNvPr id="5" name="Shape 5"/>
                <wps:spPr>
                  <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
                  <a:solidFill><a:srgbClr val="93B3D7"/></a:solidFill>
                  <a:ln><a:noFill/></a:ln>
                </wps:spPr>
              </wps:wsp>
            </a:graphicData>
          </a:graphic>
        </wp:anchor>
      </w:drawing>
    `;

    const root = defaultXmlAdapter.parse(xml);
    const shape = parseDrawingNode(root);

    expect(shape).toBeDefined();
    expect(shape?.fill).toBe('#93B3D7');
    // <a:noFill/> means no outline — not a default black stroke.
    expect(shape?.stroke).toBeUndefined();
    expect(shape?.anchor?.horizontalFrom).toBe('column');
    expect(shape?.anchor?.horizontalOffsetPt).toBeCloseTo(6, 0);
    expect(shape?.anchor?.verticalFrom).toBe('paragraph');
  });

  it('maps straightConnector shapes to line geometry', () => {
    const xml = `
      <w:drawing xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
                 xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
                 xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
                 xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">
        <wp:anchor>
          <wp:extent cx="5725236" cy="12700"/>
          <wp:docPr id="312" name=""/>
          <a:graphic>
            <a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">
              <wps:wsp>
                <wps:spPr>
                  <a:prstGeom prst="straightConnector1"><a:avLst/></a:prstGeom>
                  <a:ln w="12700"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln>
                </wps:spPr>
              </wps:wsp>
            </a:graphicData>
          </a:graphic>
        </wp:anchor>
      </w:drawing>
    `;

    const root = defaultXmlAdapter.parse(xml);
    const shape = parseDrawingNode(root);

    expect(shape).toBeDefined();
    expect(shape?.commands[0]?.type).toBe('moveTo');
    expect(shape?.commands[1]).toEqual({ type: 'lineTo', points: [shape!.widthPt!, shape!.heightPt!] });
    expect(shape?.stroke?.color).toBe('#000000');
  });

  it('should generate canonical preset geometries', () => {
    const rectCmds = generatePresetGeometry('rect', 80, 40);
    expect(rectCmds[0]).toEqual({ type: 'moveTo', points: [0, 0] });
    expect(rectCmds[1]).toEqual({ type: 'lineTo', points: [80, 0] });
    expect(rectCmds[2]).toEqual({ type: 'lineTo', points: [80, 40] });
    expect(rectCmds[3]).toEqual({ type: 'lineTo', points: [0, 40] });
    expect(rectCmds[4]).toEqual({ type: 'close', points: [] });

    const triCmds = generatePresetGeometry('triangle', 60, 60);
    expect(triCmds[0]).toEqual({ type: 'moveTo', points: [30, 0] });
    expect(triCmds[1]).toEqual({ type: 'lineTo', points: [60, 60] });
    expect(triCmds[2]).toEqual({ type: 'lineTo', points: [0, 60] });
    expect(triCmds[3]).toEqual({ type: 'close', points: [] });
  });
});
