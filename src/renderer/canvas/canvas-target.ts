/**
 * Generic Canvas Rendering Target.
 * Compatible with standard CanvasRenderingContext2D and OffscreenCanvasRenderingContext2D.
 */

export interface CanvasTarget {
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  scale(x: number, y: number): void;
  fillText(text: string, x: number, y: number): void;
  strokeRect(x: number, y: number, w: number, h: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;

  beginPath?(): void;
  closePath?(): void;
  moveTo?(x: number, y: number): void;
  lineTo?(x: number, y: number): void;
  bezierCurveTo?(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number): void;
  quadraticCurveTo?(cpx: number, cpy: number, x: number, y: number): void;
  arc?(x: number, y: number, radius: number, startAngle: number, endAngle: number, counterclockwise?: boolean): void;
  fill?(): void;
  stroke?(): void;
  setLineDash?(segments: number[]): void;
  drawImage?(image: CanvasImageSource | string, x: number, y: number, w: number, h: number): void;

  font: string;
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
}
