#!/usr/bin/env python3
"""
Ooxen external-audit validator (roadmap Fase 4).

Validates an engine-generated .docx against the official ECMA-376
(ISO/IEC 29500) XSD schemas, then opens it with python-docx as an
independent-parser compatibility check.

Usage:
    python3 scripts/audit/validate.py <file.docx> [--schemas <dir>]

Exit code 0 = all checks passed, 1 = failures found, 2 = environment error.
"""
import argparse
import sys
import tempfile
import zipfile
from pathlib import Path

from lxml import etree

# Map of part-name patterns to the XSD that governs them.
WML = 'wml.xsd'
PART_SCHEMA_MAP = {
    '[Content_Types].xml': 'opc-contentTypes.xsd',
    '_rels/.rels': 'opc-relationships.xsd',
    'docProps/core.xml': 'opc-coreProperties.xsd',
    'docProps/app.xml': 'shared-documentPropertiesExtended.xsd',
    'word/document.xml': WML,
    'word/styles.xml': WML,
    'word/numbering.xml': WML,
    'word/footnotes.xml': WML,
    'word/endnotes.xml': WML,
    'word/comments.xml': WML,
    'word/commentsExtended.xml': WML,
    'word/settings.xml': WML,
    'word/fontTable.xml': WML,
}


def is_relationship_part(name: str) -> bool:
    return name.endswith('.rels')


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('docx')
    parser.add_argument(
        '--schemas',
        default=str(Path(__file__).parent / 'schemas'),
        help='Directory containing ECMA-376 XSD files',
    )
    args = parser.parse_args()

    schemas_dir = Path(args.schemas)
    docx_path = Path(args.docx)
    if not docx_path.exists():
        print(f'ERROR: {docx_path} not found')
        return 2

    failures: list[str] = []
    validated = 0

    with tempfile.TemporaryDirectory() as tmp:
        with zipfile.ZipFile(docx_path) as zf:
            names = zf.namelist()
            zf.extractall(tmp)

        schema_cache: dict[str, etree.XMLSchema] = {}

        def get_schema(xsd_name: str) -> etree.XMLSchema:
            if xsd_name not in schema_cache:
                xsd_path = schemas_dir / xsd_name
                schema_doc = etree.parse(str(xsd_path))
                schema_cache[xsd_name] = etree.XMLSchema(schema_doc)
            return schema_cache[xsd_name]

        print(f'== XSD validation ({docx_path.name}) ==')
        for name in sorted(names):
            if not name.endswith('.xml') and not is_relationship_part(name):
                continue

            if is_relationship_part(name):
                xsd_name = 'opc-relationships.xsd'
            else:
                xsd_name = PART_SCHEMA_MAP.get(name)
            if xsd_name is None:
                continue

            xml_path = Path(tmp) / name
            xml_doc = etree.parse(str(xml_path))
            schema = get_schema(xsd_name)
            if schema.validate(xml_doc):
                validated += 1
                print(f'  PASS {name} ({xsd_name})')
            else:
                for error in schema.error_log:
                    failures.append(f'{name}: {error.message} (line {error.line})')
                print(f'  FAIL {name} ({xsd_name})')

        print(f'\nXSD parts validated: {validated}, failures: {len(failures)}')
        for failure in failures:
            print(f'  ! {failure}')

    # Independent-parser compatibility check (python-docx = lxml strict OPC reader).
    print('\n== python-docx open test ==')
    try:
        import docx  # noqa: PLC0415

        document = docx.Document(str(docx_path))
        print(f'  PASS opened: {len(document.paragraphs)} paragraphs, {len(document.tables)} tables, '
              f'{len(document.sections)} sections')
    except Exception as error:  # noqa: BLE001
        failures.append(f'python-docx: {error}')
        print(f'  FAIL {error}')

    if failures:
        print(f'\nRESULT: FAIL ({len(failures)} problems)')
        return 1
    print('\nRESULT: PASS')
    return 0


if __name__ == '__main__':
    sys.exit(main())
