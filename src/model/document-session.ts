import { defaultPageEngine, type PageLayout } from '../layout/page-engine.js';
import { sliceParagraphRange } from '../layout/range-slicer.js';
import { hitTestPage, type HitTestResult } from '../layout/hit-test.js';
import type { CanvasTarget } from '../renderer/canvas/canvas-target.js';
import { defaultPageRenderer } from '../renderer/canvas/page-renderer.js';
import { defaultHtmlRenderer } from '../renderer/html/html-renderer.js';
import { defaultOoxenWriter } from '../serializer/ooxen-writer.js';
import type { BlockNode, DocumentNode, RevisionInfo, RunNode } from '../types/ast.js';
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
 * Pure function: accepts all revisions (keeps inserts as normal runs, removes deleted runs).
 */
export function acceptDocumentRevisions(doc: DocumentNode): DocumentNode {
  const transformRun = (run: RunNode): RunNode[] => {
    if (run.revision?.type === 'delete') {
      return [];
    }
    if (run.revision?.type === 'insert') {
      const { revision: _, ...cleaned } = run;
      return [cleaned];
    }
    return [run];
  };

  const transformBlock = (block: BlockNode): BlockNode => {
    if (block.type === 'paragraph') {
      const newRuns = block.children.flatMap(transformRun);
      return { ...block, children: newRuns };
    }
    if (block.type === 'table') {
      const newRows = block.rows.map((row) => ({
        ...row,
        children: row.children.map((cell) => ({
          ...cell,
          children: cell.children.map(transformBlock),
        })),
      }));
      return { ...block, rows: newRows };
    }
    return block;
  };

  return {
    ...doc,
    sections: doc.sections.map((section) => ({
      ...section,
      children: section.children.map(transformBlock),
    })),
  };
}

/**
 * Pure function: rejects all revisions (removes inserts, restores deleted runs as normal runs).
 */
export function rejectDocumentRevisions(doc: DocumentNode): DocumentNode {
  const transformRun = (run: RunNode): RunNode[] => {
    if (run.revision?.type === 'insert') {
      return [];
    }
    if (run.revision?.type === 'delete') {
      const { revision: _, ...cleaned } = run;
      return [cleaned];
    }
    return [run];
  };

  const transformBlock = (block: BlockNode): BlockNode => {
    if (block.type === 'paragraph') {
      const newRuns = block.children.flatMap(transformRun);
      return { ...block, children: newRuns };
    }
    if (block.type === 'table') {
      const newRows = block.rows.map((row) => ({
        ...row,
        children: row.children.map((cell) => ({
          ...cell,
          children: cell.children.map(transformBlock),
        })),
      }));
      return { ...block, rows: newRows };
    }
    return block;
  };

  return {
    ...doc,
    sections: doc.sections.map((section) => ({
      ...section,
      children: section.children.map(transformBlock),
    })),
  };
}

/**
 * Pure function: collects all distinct revision metadata from a DocumentNode.
 */
export function collectDocumentRevisions(doc: DocumentNode): RevisionInfo[] {
  const revisions: RevisionInfo[] = [];
  const seen = new Set<string>();

  const checkRun = (run: RunNode) => {
    if (run.revision) {
      const key = `${run.revision.type}:${run.revision.id ?? ''}:${run.revision.author ?? ''}:${run.revision.date ?? ''}`;
      if (!seen.has(key)) {
        seen.add(key);
        revisions.push(run.revision);
      }
    }
  };

  const checkBlock = (block: BlockNode) => {
    if (block.type === 'paragraph') {
      block.children.forEach(checkRun);
    } else if (block.type === 'table') {
      block.rows.forEach((r) => r.children.forEach((c) => c.children.forEach(checkBlock)));
    }
  };

  doc.sections.forEach((s) => s.children.forEach(checkBlock));
  return revisions;
}

/**
 * Plain object session interface for interactive document views (Canvas, HTML, book-canvas).
 */
export interface DocumentSession {
  readonly document: DocumentNode;
  readonly pages: PageLayout[];
  hitTest(x: number, y: number, pageIndex?: number): HitTestResult | undefined;
  applyRangeStyle(paragraphIndex: number, start: number, end: number, patchStyle: TextStyle): DocumentSession;
  acceptRevisions(): DocumentSession;
  rejectRevisions(): DocumentSession;
  getRevisions(): RevisionInfo[];
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

    acceptRevisions(): DocumentSession {
      const acceptedDoc = acceptDocumentRevisions(initialDoc);
      return createDocumentSession(acceptedDoc);
    },

    rejectRevisions(): DocumentSession {
      const rejectedDoc = rejectDocumentRevisions(initialDoc);
      return createDocumentSession(rejectedDoc);
    },

    getRevisions(): RevisionInfo[] {
      return collectDocumentRevisions(initialDoc);
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
