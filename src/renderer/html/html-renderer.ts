import type { DocumentNode } from '../../types/ast.js';

/**
 * Renders Document AST into semantic HTML markup or DOM nodes.
 */

export interface HtmlRenderer {
  renderToHtmlString(document: DocumentNode): string;
}
