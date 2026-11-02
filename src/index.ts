/**
 * Ooxen - Universal bidirectional read-write-render engine for Office Open XML (ISO/IEC 29500)
 */

export const VERSION = '0.1.2';

// AST and Types
export * from './types/ast.js';
export * from './types/common.js';
export * from './types/style.js';

// OPC (ISO/IEC 29500-2)
export * from './opc/package.js';
export * from './opc/content-types.js';
export * from './opc/relationships.js';
export * from './opc/zip/zip-reader.js';
export * from './opc/zip/zip-writer.js';

// Parser (ISO/IEC 29500-1)
export * from './parser/namespaces.js';
export * from './parser/xml-adapter.js';
export * from './parser/wml/document-parser.js';
export * from './parser/wml/paragraph-parser.js';
export * from './parser/wml/table-parser.js';
export * from './parser/wml/style-resolver.js';
export * from './parser/wml/numbering-resolver.js';
export * from './parser/wml/header-footer-parser.js';
export * from './parser/dml/shape-parser.js';
export * from './parser/dml/image-parser.js';
export * from './parser/metadata/metadata-parser.js';
export * from './parser/wml/footnote-parser.js';

// Layout
export * from './layout/page-engine.js';
export * from './layout/line-breaker.js';
export * from './layout/text-metrics.js';
export * from './layout/range-slicer.js';
export * from './layout/hit-test.js';

// Interactive Model & Document Session (Plain Object API)
export * from './model/document-session.js';

// Renderer (Canvas & HTML)
export * from './renderer/canvas/canvas-target.js';
export * from './renderer/canvas/page-renderer.js';
export * from './renderer/canvas/draw-primitives.js';
export * from './renderer/html/html-renderer.js';
export * from './renderer/html/style-mapper.js';

// Serializer (Bidirectional OOXML Generator)
export * from './serializer/ooxen-writer.js';
export * from './serializer/wml-builder.js';
export * from './serializer/styles-builder.js';
export * from './serializer/numbering-builder.js';
export * from './serializer/metadata-builder.js';
export * from './serializer/footnote-builder.js';
export * from './serializer/package-builder.js';
