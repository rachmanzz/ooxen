# Ooxen

Universal bidirectional read-write-render engine for Office Open XML (OOXML).

Ooxen is a pure headless rendering engine—not a direct UI viewer—designed to handle bidirectional transformations between Office Open XML and web-native representations:
- **OOXML to XML-HTML / Canvas**: Parses OOXML documents and renders them into structured XML-HTML or HTML5 Canvas representations.
- **HTML-Canvas to OOXML**: Serializes HTML-Canvas representations back into valid OOXML document packages.

## Architecture & Runtime

- **Language**: TypeScript
- **Portability**: Runtime-agnostic and isomorphic. Designed to run seamlessly in both browser and backend (Node.js, Deno, Bun) environments without hard dependencies on Node.js-specific builtins.
- **Role**: Pure rendering and transformation pipeline. Integration with application views, editors, or UI shells is handled via standard Canvas or HTML interfaces.

## Standards Compliance

Ooxen targets the **ISO/IEC 29500** (ECMA-376) standard. Current coverage:

- **ISO/IEC 29500-1**: WordprocessingML (`.docx`) and DrawingML (subset) — implemented.
- **ISO/IEC 29500-2**: Open Packaging Conventions (OPC) for ZIP container structure, relationship parts (`.rels`), and content types (`[Content_Types].xml`) — implemented.
- **SpreadsheetML** (`.xlsx`) and **PresentationML** (`.pptx`) — planned, not yet implemented.
- **ISO/IEC 29500-3 & 4** (MCE / transitional conformance) — planned, not yet implemented.

Conformance is currently verified by the project's own test suite; XSD schema validation and third-party application compatibility testing are not yet part of the audit procedure (see `.knowledges/audit/iso-29500-checklist.md`).

## License

This project is licensed under the [Apache License 2.0](LICENSE).
