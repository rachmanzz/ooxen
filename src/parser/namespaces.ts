/**
 * ISO/IEC 29500 official XML namespaces registry.
 */

export const NAMESPACES = {
  // ISO/IEC 29500 Part 1 - WordprocessingML
  WML_STRICT: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  WML_TRANSITIONAL: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',

  // DrawingML
  DRAWING_ML_MAIN: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  DRAWING_ML_WORD: 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',

  // Relationships
  PACKAGE_RELATIONSHIPS: 'http://schemas.openxmlformats.org/package/2006/relationships',
  DOCUMENT_RELATIONSHIPS: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',

  // Markup Compatibility and Extensibility (MCE, Part 3)
  MCE: 'http://schemas.openxmlformats.org/markup-compatibility/2006',
} as const;
