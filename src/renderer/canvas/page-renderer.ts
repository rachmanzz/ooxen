import type { PageLayout } from '../../layout/page-engine.js';
import type { CanvasTarget } from './canvas-target.js';

/**
 * Host-Agnostic Page Renderer.
 * Renders a single discrete PageLayout onto a provided CanvasTarget.
 */

export interface PageRenderer {
  renderPage(page: PageLayout, target: CanvasTarget): void;
}
