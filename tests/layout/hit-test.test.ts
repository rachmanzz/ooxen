import { describe, expect, it } from 'bun:test';
import { hitTestPage } from '../../src/layout/hit-test.js';
import type { PageLayout } from '../../src/layout/page-engine.js';

describe('Hit Testing Pure Function', () => {
  const samplePage: PageLayout = {
    pageIndex: 0,
      pageNumber: 1,
      orientation: 'portrait',
    size: { width: 612, height: 792 },
    margins: { top: 72, right: 72, bottom: 72, left: 72 },
    lines: [
      {
        bounds: { x: 72, y: 72, width: 100, height: 16 },
        baseline: 12,
        fragments: [
          {
            text: 'Hello',
            bounds: { x: 0, y: 0, width: 40, height: 16 },
          },
          {
            text: 'World',
            bounds: { x: 50, y: 0, width: 50, height: 16 },
          },
        ],
      },
      {
        bounds: { x: 72, y: 92, width: 80, height: 16 },
        baseline: 12,
        fragments: [
          {
            text: 'SecondLine',
            bounds: { x: 0, y: 0, width: 80, height: 16 },
          },
        ],
      },
    ],
  };

  it('should locate character offset on line 0 for coordinates inside fragment', () => {
    // x = 72 + 20 (middle of 'Hello' fragment)
    const result = hitTestPage(samplePage, 92, 75);
    expect(result).toBeDefined();
    expect(result?.lineIndex).toBe(0);
    expect(result?.fragmentIndex).toBe(0);
    expect(result?.text).toBe('Hello');
    expect(result?.charOffsetInFragment).toBeGreaterThanOrEqual(1);
    expect(result?.charOffsetInFragment).toBeLessThanOrEqual(4);
  });

  it('should locate fragment 1 on line 0 when clicking on the right', () => {
    // x = 72 + 75 (middle of 'World' fragment)
    const result = hitTestPage(samplePage, 147, 75);
    expect(result).toBeDefined();
    expect(result?.lineIndex).toBe(0);
    expect(result?.fragmentIndex).toBe(1);
    expect(result?.text).toBe('World');
  });

  it('should locate line 1 when clicking vertically lower', () => {
    const result = hitTestPage(samplePage, 80, 95);
    expect(result).toBeDefined();
    expect(result?.lineIndex).toBe(1);
    expect(result?.text).toBe('SecondLine');
  });
});
