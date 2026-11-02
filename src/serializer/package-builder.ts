import type { OpcPackage } from '../opc/package.js';

/**
 * Assembles generated parts into a valid OPC container package.
 */

export interface PackageBuilder {
  assemblePackage(documentXml: string, stylesXml?: string): OpcPackage;
}
