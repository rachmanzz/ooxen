import type {
  BlockNode,
  DocumentNode,
  DrawingShapeNode,
  ImageNode,
  ParagraphNode,
  RunNode,
  SectionNode,
  TableCellNode,
  TableNode,
  TableRowNode,
  VectorPathCommand,
} from '../../types/ast.js';
import { uint8ArrayToBase64 } from '../../types/common.js';
import { defaultStyleMapper, type StyleMapper } from './style-mapper.js';

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function commandsToSvgPath(commands: VectorPathCommand[]): string {
  return commands
    .map((cmd) => {
      switch (cmd.type) {
        case 'moveTo':
          return `M ${cmd.points[0]} ${cmd.points[1]}`;
        case 'lineTo':
          return `L ${cmd.points[0]} ${cmd.points[1]}`;
        case 'cubicBezTo':
          return `C ${cmd.points[0]} ${cmd.points[1]} ${cmd.points[2]} ${cmd.points[3]} ${cmd.points[4]} ${cmd.points[5]}`;
        case 'quadBezTo':
          return `Q ${cmd.points[0]} ${cmd.points[1]} ${cmd.points[2]} ${cmd.points[3]}`;
        case 'close':
          return 'Z';
        default:
          return '';
      }
    })
    .filter(Boolean)
    .join(' ');
}

export function renderShapeToSvg(shape: DrawingShapeNode): string {
  const d = commandsToSvgPath(shape.commands);
  const fill = shape.fill ? escapeXml(shape.fill) : 'none';
  const stroke = shape.stroke?.color ? escapeXml(shape.stroke.color) : 'none';
  const strokeWidth = shape.stroke?.widthPt ?? 1;

  return `<svg class="ooxen-shape" width="${shape.widthPt}pt" height="${shape.heightPt}pt" viewBox="0 0 ${shape.widthPt} ${shape.heightPt}" xmlns="http://www.w3.org/2000/svg"><path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/></svg>`;
}

export function renderImageToHtml(image: ImageNode): string {
  const alt = image.altText ?? image.name ?? '';
  let src = image.src;
  if (!src && image.data && image.mimeType) {
    src = `data:${image.mimeType};base64,${uint8ArrayToBase64(image.data)}`;
  }
  src = src ?? '';

  return `<img class="ooxen-image" src="${escapeXml(src)}" alt="${escapeXml(alt)}" style="width: ${image.widthPt}pt; height: ${image.heightPt}pt;" />`;
}

/**
 * Strict well-formed XML-HTML (XHTML) Document Renderer.
 */

export interface HtmlRenderer {
  renderToHtmlString(document: DocumentNode): string;
}

export class StandardHtmlRenderer implements HtmlRenderer {
  private styleMapper: StyleMapper;

  constructor(styleMapper: StyleMapper = defaultStyleMapper) {
    this.styleMapper = styleMapper;
  }

  renderToHtmlString(document: DocumentNode): string {
    const sectionsHtml = document.sections.map((s) => this.renderSection(s)).join('\n');

    let footnotesHtml = '';
    if (document.footnotes && document.footnotes.length > 0) {
      const validNotes = document.footnotes.filter((fn) => fn.id > 0);
      if (validNotes.length > 0) {
        const items = validNotes
          .map((fn) => {
            const inner = fn.children.map((b) => this.renderBlock(b)).join('\n');
            return `      <li id="fn-${fn.id}">\n${inner}\n      </li>`;
          })
          .join('\n');
        footnotesHtml = `\n    <aside class="ooxen-footnotes">\n      <hr class="ooxen-footnote-separator" />\n      <ol>\n${items}\n      </ol>\n    </aside>`;
      }
    }

    let endnotesHtml = '';
    if (document.endnotes && document.endnotes.length > 0) {
      const validNotes = document.endnotes.filter((en) => en.id > 0);
      if (validNotes.length > 0) {
        const items = validNotes
          .map((en) => {
            const inner = en.children.map((b) => this.renderBlock(b)).join('\n');
            return `      <li id="en-${en.id}">\n${inner}\n      </li>`;
          })
          .join('\n');
        endnotesHtml = `\n    <aside class="ooxen-endnotes">\n      <hr class="ooxen-endnote-separator" />\n      <ol>\n${items}\n      </ol>\n    </aside>`;
      }
    }

    let commentsHtml = '';
    if (document.comments && document.comments.length > 0) {
      const items = document.comments
        .map((c) => {
          const authorAttr = c.author ? ` data-author="${escapeXml(c.author)}"` : '';
          const dateAttr = c.date ? ` data-date="${escapeXml(c.date)}"` : '';
          const initialsAttr = c.initials ? ` data-initials="${escapeXml(c.initials)}"` : '';
          const inner = c.children.map((b) => this.renderBlock(b)).join('\n');
          return `      <div class="ooxen-comment-card" id="comment-${escapeXml(c.id)}"${authorAttr}${dateAttr}${initialsAttr}>\n${inner}\n      </div>`;
        })
        .join('\n');
      commentsHtml = `\n    <aside class="ooxen-comments">\n${items}\n    </aside>`;
    }

    const articleHtml = `<article class="ooxen-document" xmlns="http://www.w3.org/1999/xhtml">\n${sectionsHtml}${footnotesHtml}${endnotesHtml}${commentsHtml}\n</article>`;

    if (!document.metadata) {
      return articleHtml;
    }

    const headLines: string[] = [];
    if (document.metadata.title) {
      headLines.push(`    <title>${escapeXml(document.metadata.title)}</title>`);
    }
    if (document.metadata.creator) {
      headLines.push(`    <meta name="author" content="${escapeXml(document.metadata.creator)}" />`);
    }
    if (document.metadata.description) {
      headLines.push(`    <meta name="description" content="${escapeXml(document.metadata.description)}" />`);
    }
    if (document.metadata.keywords && document.metadata.keywords.length > 0) {
      headLines.push(`    <meta name="keywords" content="${escapeXml(document.metadata.keywords.join(', '))}" />`);
    }
    if (document.metadata.subject) {
      headLines.push(`    <meta name="subject" content="${escapeXml(document.metadata.subject)}" />`);
    }
    if (document.metadata.application) {
      headLines.push(`    <meta name="generator" content="${escapeXml(document.metadata.application)}" />`);
    }

    if (headLines.length === 0) {
      return articleHtml;
    }

    return `<html xmlns="http://www.w3.org/1999/xhtml">\n  <head>\n${headLines.join('\n')}\n  </head>\n  <body>\n${articleHtml}\n  </body>\n</html>`;
  }

  private renderSection(section: SectionNode): string {
    const { pageSize, margins, columns } = section.properties;
    const styleObj: Record<string, string> = {
      width: `${pageSize.width}pt`,
      'min-height': `${pageSize.height}pt`,
      padding: `${margins.top}pt ${margins.right}pt ${margins.bottom}pt ${margins.left}pt`,
      'box-sizing': 'border-box',
    };

    if (columns && columns.count > 1) {
      styleObj['column-count'] = String(columns.count);
      styleObj['column-gap'] = `${columns.spacePt ?? 36}pt`;
      if (columns.separator) {
        styleObj['column-rule'] = '1px solid #CCCCCC';
      }
    }

    const styleStr = this.styleMapper.toCssString(styleObj);

    let headerHtml = '';
    const defaultHeader = section.headers?.default ?? section.headers?.first;
    if (defaultHeader && defaultHeader.children.length > 0) {
      const headerBlocks = defaultHeader.children
        .map((b) => this.renderBlock(b))
        .join('\n');
      headerHtml = `    <header class="ooxen-header">\n${headerBlocks}\n    </header>\n`;
    }

    const childrenHtml = section.children
      .map((block) => this.renderBlock(block))
      .join('\n');

    let footerHtml = '';
    const defaultFooter = section.footers?.default ?? section.footers?.first;
    if (defaultFooter && defaultFooter.children.length > 0) {
      const footerBlocks = defaultFooter.children
        .map((b) => this.renderBlock(b))
        .join('\n');
      footerHtml = `\n    <footer class="ooxen-footer">\n${footerBlocks}\n    </footer>`;
    }

    return `  <section class="ooxen-section" style="${escapeXml(styleStr)}">\n${headerHtml}${childrenHtml}${footerHtml}\n  </section>`;
  }

  private renderBlock(block: BlockNode): string {
    if (block.type === 'paragraph') return this.renderParagraph(block);
    if (block.type === 'table') return this.renderTable(block);
    if (block.type === 'image') return `    ${renderImageToHtml(block)}`;
    return `    ${renderShapeToSvg(block)}`;
  }

  private renderParagraph(paragraph: ParagraphNode): string {
    const cssObj = this.styleMapper.paragraphStyleToCss(paragraph.style);
    const styleAttr = Object.keys(cssObj).length > 0 ? ` style="${escapeXml(this.styleMapper.toCssString(cssObj))}"` : '';
    const idAttr = paragraph.bookmarkName ? ` id="${escapeXml(paragraph.bookmarkName)}"` : '';

    const prefixHtml = paragraph.style?.numbering?.prefixText
      ? `<span class="ooxen-bullet" style="display: inline-block; min-width: 1.5em;">${escapeXml(paragraph.style.numbering.prefixText)} </span>`
      : '';

    const runsHtml = paragraph.children.map((run) => this.renderRun(run)).join('');
    return `    <p class="ooxen-p"${idAttr}${styleAttr}>${prefixHtml}${runsHtml}</p>`;
  }

  private renderRun(run: RunNode): string {
    const cssObj = this.styleMapper.textStyleToCss(run.style);
    const styleAttr = Object.keys(cssObj).length > 0 ? ` style="${escapeXml(this.styleMapper.toCssString(cssObj))}"` : '';
    const idAttr = run.bookmarkName ? ` id="${escapeXml(run.bookmarkName)}"` : '';

    // Convert newlines in run text to self-closing <br/> tags
    const escaped = escapeXml(run.text).replace(/\n/g, '<br/>');
    const shapeSvg = run.drawing ? renderShapeToSvg(run.drawing) : '';
    const imageHtml = run.image ? renderImageToHtml(run.image) : '';
    const fieldClass = run.field ? ` ooxen-field-${run.field.toLowerCase()}` : '';

    const spanHtml = `<span class="ooxen-r${fieldClass}"${idAttr}${styleAttr}>${escaped}${shapeSvg}${imageHtml}</span>`;

    let outHtml = spanHtml;

    if (run.footnoteRef) {
      const refKind = run.footnoteRef.kind;
      const prefix = refKind === 'footnote' ? 'fn' : 'en';
      const mark = run.footnoteRef.mark ?? run.footnoteRef.id;
      outHtml = `<sup class="ooxen-${refKind}-ref"><a href="#${prefix}-${run.footnoteRef.id}">[${mark}]</a></sup>`;
    } else if (run.hyperlink) {
      const href = run.hyperlink.url
        ? ` href="${escapeXml(run.hyperlink.url)}"`
        : run.hyperlink.anchor
          ? ` href="#${escapeXml(run.hyperlink.anchor)}"`
          : '';
      const title = run.hyperlink.tooltip ? ` title="${escapeXml(run.hyperlink.tooltip)}"` : '';
      outHtml = `<a class="ooxen-link"${href}${title}>${spanHtml}</a>`;
    }

    if (run.breakType === 'page') {
      outHtml = `${outHtml}<span class="ooxen-page-break" style="break-before: page; page-break-before: always;"></span>`;
    } else if (run.breakType === 'column') {
      outHtml = `${outHtml}<span class="ooxen-column-break" style="break-before: column;"></span>`;
    }

    if (run.revision) {
      const authorAttr = run.revision.author ? ` data-author="${escapeXml(run.revision.author)}"` : '';
      const dateAttr = run.revision.date ? ` data-date="${escapeXml(run.revision.date)}"` : '';
      const idAttr = run.revision.id ? ` data-id="${escapeXml(run.revision.id)}"` : '';
      const tag = run.revision.type === 'insert' ? 'ins' : 'del';
      outHtml = `<${tag} class="ooxen-${tag}"${idAttr}${authorAttr}${dateAttr}>${outHtml}</${tag}>`;
    }

    if (run.commentId) {
      return `<mark class="ooxen-comment" data-comment-id="${escapeXml(run.commentId)}">${outHtml}</mark>`;
    }

    return outHtml;
  }

  private renderTable(table: TableNode): string {
    const tableStyle: Record<string, string> = {
      'border-collapse': 'collapse',
    };

    if (table.style?.widthPercent !== undefined) {
      tableStyle['width'] = `${table.style.widthPercent}%`;
    } else if (table.style?.widthPt !== undefined) {
      tableStyle['width'] = `${table.style.widthPt}pt`;
    } else {
      tableStyle['width'] = '100%';
    }

    if (table.style?.alignment === 'center') {
      tableStyle['margin-left'] = 'auto';
      tableStyle['margin-right'] = 'auto';
    } else if (table.style?.alignment === 'right') {
      tableStyle['margin-left'] = 'auto';
      tableStyle['margin-right'] = '0';
    } else if (table.style?.alignment === 'left') {
      tableStyle['margin-right'] = 'auto';
    }

    if (table.style?.borderTop) tableStyle['border-top'] = table.style.borderTop;
    if (table.style?.borderRight) tableStyle['border-right'] = table.style.borderRight;
    if (table.style?.borderBottom) tableStyle['border-bottom'] = table.style.borderBottom;
    if (table.style?.borderLeft) tableStyle['border-left'] = table.style.borderLeft;

    const styleAttr = ` style="${escapeXml(this.styleMapper.toCssString(tableStyle))}"`;

    let colgroupHtml = '';
    if (table.columnWidthsPt && table.columnWidthsPt.length > 0) {
      const cols = table.columnWidthsPt.map((w) => `        <col style="width: ${w}pt;"/>`).join('\n');
      colgroupHtml = `      <colgroup>\n${cols}\n      </colgroup>\n`;
    }

    const rowsHtml = table.rows.map((row) => this.renderTableRow(row)).join('\n');
    return `    <table class="ooxen-table"${styleAttr}>\n${colgroupHtml}      <tbody>\n${rowsHtml}\n      </tbody>\n    </table>`;
  }

  private renderTableRow(row: TableRowNode): string {
    const styleObj: Record<string, string> = {};
    if (row.heightPt !== undefined) {
      styleObj['height'] = `${row.heightPt}pt`;
    }
    const styleAttr = Object.keys(styleObj).length > 0 ? ` style="${escapeXml(this.styleMapper.toCssString(styleObj))}"` : '';
    const cellsHtml = row.children
      .filter((cell) => cell.vMerge !== 'continue' && cell.rowSpan !== 0)
      .map((cell) => this.renderTableCell(cell))
      .join('');
    return `        <tr class="ooxen-tr"${styleAttr}>${cellsHtml}</tr>`;
  }

  private renderTableCell(cell: TableCellNode): string {
    const colSpanAttr = cell.colSpan && cell.colSpan > 1 ? ` colspan="${cell.colSpan}"` : '';
    const rowSpanAttr = cell.rowSpan && cell.rowSpan > 1 ? ` rowspan="${cell.rowSpan}"` : '';
    const styleObj: Record<string, string> = {};

    if (cell.widthPt !== undefined) {
      styleObj['width'] = `${cell.widthPt}pt`;
    }
    if (cell.style?.backgroundColor) {
      styleObj['background-color'] = cell.style.backgroundColor;
    }
    if (cell.style?.borderTop) styleObj['border-top'] = cell.style.borderTop;
    if (cell.style?.borderRight) styleObj['border-right'] = cell.style.borderRight;
    if (cell.style?.borderBottom) styleObj['border-bottom'] = cell.style.borderBottom;
    if (cell.style?.borderLeft) styleObj['border-left'] = cell.style.borderLeft;

    if (cell.style?.verticalAlign) {
      styleObj['vertical-align'] = cell.style.verticalAlign === 'center' ? 'middle' : cell.style.verticalAlign;
    }

    if (cell.style?.paddingTopPt !== undefined) styleObj['padding-top'] = `${cell.style.paddingTopPt}pt`;
    if (cell.style?.paddingRightPt !== undefined) styleObj['padding-right'] = `${cell.style.paddingRightPt}pt`;
    if (cell.style?.paddingBottomPt !== undefined) styleObj['padding-bottom'] = `${cell.style.paddingBottomPt}pt`;
    if (cell.style?.paddingLeftPt !== undefined) styleObj['padding-left'] = `${cell.style.paddingLeftPt}pt`;

    const styleAttr = Object.keys(styleObj).length > 0 ? ` style="${escapeXml(this.styleMapper.toCssString(styleObj))}"` : '';
    const innerHtml = cell.children
      .map((child) => {
        if (child.type === 'paragraph') return this.renderParagraph(child);
        if (child.type === 'table') return this.renderTable(child);
        if (child.type === 'image') return renderImageToHtml(child);
        return renderShapeToSvg(child);
      })
      .join('');

    return `<td class="ooxen-tc"${colSpanAttr}${rowSpanAttr}${styleAttr}>${innerHtml}</td>`;
  }
}

export const defaultHtmlRenderer = new StandardHtmlRenderer();
