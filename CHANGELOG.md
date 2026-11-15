# Changelog

## Unreleased

### Breaking

- `FloatingAnchorContext`, a public type re-exported from the package entry
  (`export * from './layout/page-engine.js'`), changed shape:
  - removed: `pageWidthPt`, `pageHeightPt`
  - added (required): `pageBox`, `marginBox` (both `AnchorReferenceBox`, a
    new exported type), `getColumnStartXPt`
  - added (optional): `resolveOutsideCell`
  Code that constructs or annotates this type against the old members fails
  to compile. No public method takes or returns the type, and no
  compatibility alias is provided; update the field names.

### Fixed

- Tabs: the document's `w:defaultTabStop` (settings.xml) now sets the default
  tab grid instead of a fixed 36pt; a hanging indent acts as an implicit tab
  stop on the first line, so `-<tab>text` lands on the indent; and a tab
  that overshoots the line end runs to the end of its line and wraps only
  the text after it, keeping trailing leader tabs (dotted/dashed rules to
  the margin) on their own line of text. `DocumentNode` gained `settings`
  and `LineBreaker.breakParagraph` an optional `LineBreakOptions` argument.
- Monospace faces (Courier New and friends) are measured with one fixed
  advance in canvas-less environments, bold included, so centred titles and
  line breaks match Word instead of drifting left and wrapping early.

- Indents: `w:firstLine` is read (the attribute was matched in the wrong
  case and dropped), `w:start`/`w:end` are accepted beside `w:left`/`w:right`,
  and `w:hanging` outranks `w:firstLine`. Numbering-level indents now sit
  between the paragraph style and direct formatting, and the level's own
  `w:firstLine`/`w:start` are read.
- Line spacing: `atLeast`, `exact`, and `atMost` rules are honoured as such
  (`atLeast`/`atMost` previously fell into the auto branch), and `auto`
  scales the paragraph's real line height through the new
  `lineSpacingMultiple` instead of a fixed 11pt-based value. The HTML
  renderer emits a unitless line-height for auto spacing, so large headings
  no longer overlap. `ParagraphStyle` gained `lineSpacingRule`,
  `lineSpacingMultiple`, and `contextualSpacing`; `ParagraphNode` gained
  `styleId`.
- `w:contextualSpacing` removes the space between same-style neighbours in
  the layout engine (body, headers/footers, table cells).
- Paragraph spacing and line rules now apply inside table cells and in
  headers/footers, not only in the body.
- The writer emits `w:pStyle`, the authored `w:lineRule` (`auto` with
  240ths, otherwise twips), and `w:contextualSpacing`.

- Heading and body text now take the run properties of their paragraph
  style (size, weight, colour, font) beneath the character style and direct
  formatting, as ISO/IEC 29500-1 §17.7.2 orders them. Previously only the
  paragraph mark inherited the size, so headings rendered like body text.
- Theme font references (`w:asciiTheme="majorHAnsi"` and friends) resolve
  through `word/theme/theme1.xml`; a theme attribute outranks its literal
  sibling, and the literal is the fallback when no theme part exists.
- Paragraphs without `w:pStyle` take the `w:default="1"` paragraph style
  (usually Normal), so its spacing and run properties apply to body text.

- Floating drawings and images: `wp:anchor` placement resolves inside table
  cells (`layoutInCell` honoured, including after a row moves to the next
  page and with vertical cell alignment), in headers and footers, and for
  block-level floats, consistently across the layout engine and the HTML
  renderer.
- `behindDoc` and `layoutInCell` are read as ST_OnOff (`1/true/on`,
  `0/false/off`); invalid values fall back to the schema default.
- Shared XML escaper for every string-built emitter (WML, OPC, HTML, SVG).
- Element local names are read through one helper in every parser and the
  writer, so prefixes containing `-` or `.` resolve consistently.
- Block-level anchored drawings/images in a hand-built AST are hosted by an
  empty paragraph once, at the layout-engine and HTML-renderer entry points,
  for every block list in the document (body, headers/footers, table cells,
  footnotes, comments).
