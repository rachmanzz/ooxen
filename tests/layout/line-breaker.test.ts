import { describe, expect, it } from 'bun:test';
import { StandardLineBreaker } from '../../src/layout/line-breaker.js';
import type { ParagraphNode } from '../../src/types/ast.js';

describe('Layout Line Breaker', () => {
  const lineBreaker = new StandardLineBreaker();

  it('should break text into multiple lines when it exceeds available width', () => {
    const paragraph: ParagraphNode = {
      type: 'paragraph',
      children: [
        {
          type: 'run',
          text: 'This is a long sentence designed to test word wrapping functionality in Ooxen layout engine.',
        },
      ],
    };

    // Width of 150pt should force multiple lines
    const lines = lineBreaker.breakParagraph(paragraph, 150);
    expect(lines.length).toBeGreaterThan(1);

    for (const line of lines) {
      expect(line.bounds.width).toBeLessThanOrEqual(160); // within tolerance
      expect(line.fragments.length).toBeGreaterThan(0);
    }
  });

  it('should respect explicit line breaks', () => {
    const paragraph: ParagraphNode = {
      type: 'paragraph',
      children: [
        {
          type: 'run',
          text: 'Line 1\nLine 2\nLine 3',
        },
      ],
    };

    const lines = lineBreaker.breakParagraph(paragraph, 500);
    expect(lines.length).toBe(3);
    expect(lines[0]?.fragments[0]?.text).toBe('Line');
    expect(lines[1]?.fragments[0]?.text).toBe('Line');
    expect(lines[2]?.fragments[0]?.text).toBe('Line');
  });

  it('should apply center and right alignment offsets', () => {
    const paragraphCenter: ParagraphNode = {
      type: 'paragraph',
      style: { alignment: 'center' },
      children: [{ type: 'run', text: 'Centered' }],
    };

    const linesCenter = lineBreaker.breakParagraph(paragraphCenter, 300);
    expect(linesCenter.length).toBe(1);
    expect(linesCenter[0]?.fragments[0]?.bounds.x).toBeGreaterThan(0);

    const paragraphRight: ParagraphNode = {
      type: 'paragraph',
      style: { alignment: 'right' },
      children: [{ type: 'run', text: 'Right' }],
    };

    const linesRight = lineBreaker.breakParagraph(paragraphRight, 300);
    expect(linesRight.length).toBe(1);
    expect(linesRight[0]?.fragments[0]?.bounds.x).toBeGreaterThan(linesCenter[0]?.fragments[0]?.bounds.x ?? 0);
  });
});
