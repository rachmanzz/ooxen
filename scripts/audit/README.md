# Audit Tooling (Roadmap Fase 4)

External-audit tooling for ISO/IEC 29500 conformance. Dev-only — not part of the
runtime library.

## Components

- `make-sample.ts` — generates a feature-exhaustive sample `.docx` exercising
  every implemented engine feature (styles, numbering, image, table with
  vertical merge, footnote, comment, hyperlink, header/footer, metadata).
- `validate.py` — validates every XML part of the generated package against the
  official ECMA-376 XSD schemas using `lxml`, then opens the package with
  `python-docx` as an independent-parser compatibility check.
- `schemas/` — the XSD schema files described below.

## Usage

```sh
npm run audit:validate
```

(regenerates the sample into `${TMPDIR:-/tmp}/ooxen-audit/` and validates it),
or directly:

```sh
bun scripts/audit/make-sample.ts sample.docx
python3 scripts/audit/validate.py sample.docx
```

Requirements: Python 3 with `lxml` (XSD validation) and `python-docx`
(independent open test).

## Schema provenance

- **ECMA-376 Part 1 (XML schemas, Transitional)** — 26 files
  (`wml.xsd`, `dml-*.xsd`, `pml.xsd`, `sml.xsd`, `shared-*.xsd`, `vml-*.xsd`)
  from the ECMA-376 5th edition schema distribution, obtained via the
  `QtExcel/ecma-376-5th` GitHub mirror
  (`ECMA-376/OfficeOpenXML-XMLSchema-Transitional/`). The official
  `ecma-international.org` ZIP endpoint could not be fetched programmatically
  at the time of setup.
- **ECMA-376 Part 2 (OPC)** — `opc-contentTypes.xsd`, `opc-relationships.xsd`,
  `opc-coreProperties.xsd`, `opc-digSig.xsd` from
  `OpenPackagingConventions-XMLSchema/` in the same mirror.
- **Dublin Core** — `dc.xsd`, `dcterms.xsd`, `dcmitype.xsd` fetched from
  `dublincore.org` (required by `opc-coreProperties.xsd`).
- **XML namespace** — `xml.xsd` fetched from `w3.org` (the built-in
  `http://www.w3.org/XML/1998/namespace` namespace schema).

### Local patches (tooling-only, not spec changes)

Absolute `schemaLocation` URLs were rewritten to local relative filenames so
validation works offline:

- `opc-coreProperties.xsd`: dublincore.org URLs → `dc.xsd` / `dcterms.xsd`
- `dc.xsd`, `dcterms.xsd`, `dcmitype.xsd`: w3.org URL → `xml.xsd`
- `wml.xsd`, `shared-math.xsd`: the bare
  `<xsd:import namespace="http://www.w3.org/XML/1998/namespace"/>` was given
  `schemaLocation="xml.xsd"`

## Licensing note

The ECMA-376 schemas are distributed by Ecma International as part of the
ECMA-376 standard specification (freely redistributable with the standard).
Dublin Core schemas are published by the Dublin Core Metadata Initiative.
These files are included here solely as dev-time audit tooling and are not
shipped with the runtime library.

## Environment limitations (recorded 2026-11)

- Microsoft Word, LibreOffice, and Google Docs are unavailable in this
  environment; `python-docx` (a strict, independent OOXML reader) serves as the
  third-party parser check.
- OnlyOffice `x2t` converter is installed but crashes during V8 initialization
  (`Empty MaybeLocal`) even on OnlyOffice's own reference `.docx` — a local
  packaging/environment defect, not a defect in engine output. It is therefore
  not usable as a compatibility oracle here.
