import { KNOWN_CONTENT_TYPES } from '../opc/content-types.js';
import { createPackage, type OpcPackage } from '../opc/package.js';
import { KNOWN_RELATIONSHIPS } from '../opc/relationships.js';
import { defaultStylesBuilder, type StylesBuilder } from './styles-builder.js';

const textEncoder = new TextEncoder();

/**
 * Assembles generated parts into a valid OPC container package.
 */

export interface PackageBuilder {
  assemblePackage(documentXml: string, stylesXml?: string): OpcPackage;
}

export class StandardPackageBuilder implements PackageBuilder {
  private stylesBuilder: StylesBuilder;

  constructor(stylesBuilder: StylesBuilder = defaultStylesBuilder) {
    this.stylesBuilder = stylesBuilder;
  }

  assemblePackage(documentXml: string, customStylesXml?: string): OpcPackage {
    const pkg = createPackage();

    // 1. Root Relationship to document.xml
    pkg.addRelationship(undefined, {
      id: 'rId1',
      type: KNOWN_RELATIONSHIPS.DOCUMENT,
      target: 'word/document.xml',
    });

    // 2. Add word/document.xml part
    pkg.setPart({
      name: 'word/document.xml',
      contentType: KNOWN_CONTENT_TYPES.WML_DOCUMENT_MAIN,
      data: textEncoder.encode(documentXml),
    });

    // 3. Add styles.xml part & relationship
    const stylesXml = customStylesXml ?? this.stylesBuilder.buildDefaultStylesXml();
    pkg.addRelationship('word/document.xml', {
      id: 'rId2',
      type: KNOWN_RELATIONSHIPS.STYLES,
      target: 'styles.xml',
    });

    pkg.setPart({
      name: 'word/styles.xml',
      contentType: KNOWN_CONTENT_TYPES.WML_STYLES,
      data: textEncoder.encode(stylesXml),
    });

    return pkg;
  }
}

export const defaultPackageBuilder = new StandardPackageBuilder();
