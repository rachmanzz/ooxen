import { defaultPageEngine, type PageLayout } from '../layout/page-engine.js';
import { sliceParagraphRange } from '../layout/range-slicer.js';
import { hitTestPage, type HitTestResult } from '../layout/hit-test.js';
import type { CanvasTarget } from '../renderer/canvas/canvas-target.js';
import { defaultPageRenderer } from '../renderer/canvas/page-renderer.js';
import { defaultHtmlRenderer } from '../renderer/html/html-renderer.js';
import { defaultOoxenWriter } from '../serializer/ooxen-writer.js';
import type { DocumentNode } from '../types/ast.js';
import type { TextStyle } from '../types/style.js';

/**
 * Pure function: immutably updates a paragraph within DocumentNode by slicing a range and applying a style patch.
 */
export function applyStyleToParagraph(
  doc: DocumentNode,
  paragraphIndex: number,
  start: number,
  end: number,
  patchStyle: TextStyle,
): DocumentNode {
  let currentIndex = 0;
  let modified = false;

  const newSections = doc.sections.map((section) => {
    const newChildren = section.children.map((block) => {
      if (block.type === 'paragraph') {
        if (currentIndex === paragraphIndex) {
          modified = true;
          currentIndex++;
          return sliceParagraphRange(block, start, end, patchStyle);
        }
        currentIndex++;
      }
      return block;
    });

    return {
      ...section,
      children: newChildren,
    };
  });

  if (!modified) return doc;

  return {
    ...doc,
    sections: newSections,
  };
}

/**
 * Plain object session interface for interactive document views (Canvas, HTML, book-canvas).
 */
export interface DocumentSession {
  readonly document: DocumentNode;
  readonly pages: PageLayout[];
  hitTest(x: number, y: number, pageIndex?: number): HitTestResult | undefined;
  applyRangeStyle(paragraphIndex: number, start: number, end: number, patchStyle: TextStyle): DocumentSession;
  renderPage(pageIndex: number, target: CanvasTarget): void;
  toOoxml(): Promise<Uint8Array>;
  toHtml(): string;
}

/**
 * Factory function: creates a lightweight plain object DocumentSession.
 * Zero class syntax - simple, clean, functional.
 */
export function createDocumentSession(initialDoc: DocumentNode): DocumentSession {
  const pages = defaultPageEngine.layoutDocument(initialDoc);

  const session: DocumentSession = {
    document: initialDoc,
    pages,

    hitTest(x: number, y: number, pageIndex: number = 0): HitTestResult | undefined {
      const page = pages[pageIndex];
      if (!page) return undefined;
      return hitTestPage(page, x, y);
    },

    applyRangeStyle(paragraphIndex: number, start: number, end: number, patchStyle: TextStyle): DocumentSession {
      const updatedDoc = applyStyleToParagraph(initialDoc, paragraphIndex, start, end, patchStyle);
      return createDocumentSession(updatedDoc);
    },

    renderPage(pageIndex: number, target: CanvasTarget): void {
      const page = pages[pageIndex];
      if (page) {
        defaultPageRenderer.renderPage(page, target);
      }
    },

    toOoxml(): Promise<Uint8Array> {
      return defaultOoxenWriter.write(initialDoc);
    },

    toHtml(): string {
      return defaultHtmlRenderer.renderToHtmlString(initialDoc);
    },
  };

  return session;
}
