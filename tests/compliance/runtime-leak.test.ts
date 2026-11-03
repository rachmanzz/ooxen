import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Forbidden Node.js built-ins in production code src/
const FORBIDDEN_MODULES = [
  'fs',
  'node:fs',
  'path',
  'node:path',
  'zlib',
  'node:zlib',
  'crypto',
  'node:crypto',
  'buffer',
  'node:buffer',
  'child_process',
  'node:child_process',
  'http',
  'node:http',
  'https',
  'node:https',
  'os',
  'node:os',
];

function getAllSourceFiles(dir: string): string[] {
  const files: string[] = [];
  const entries = readdirSync(dir);

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...getAllSourceFiles(fullPath));
    } else if (fullPath.endsWith('.ts')) {
      files.push(fullPath);
    }
  }

  return files;
}

describe('Compliance: Runtime-Agnostic & Zero Platform Leak', () => {
  it('should have zero imports of Node.js built-in modules in all src/ files', () => {
    const srcDir = join(process.cwd(), 'src');
    const sourceFiles = getAllSourceFiles(srcDir);

    expect(sourceFiles.length).toBeGreaterThan(0);

    const importRegex = /(?:import|export)\s+(?:.*?from\s+)?['"](.*?)['"]/g;

    for (const filePath of sourceFiles) {
      const content = readFileSync(filePath, 'utf-8');
      let match: RegExpExecArray | null;

      while ((match = importRegex.exec(content)) !== null) {
        const importSpecifier = match[1]!;

        for (const forbidden of FORBIDDEN_MODULES) {
          if (importSpecifier === forbidden) {
            throw new Error(`Forbidden Node.js import '${forbidden}' detected in production file: ${filePath}`);
          }
        }
      }
    }
  });

  it('should strictly use Uint8Array and Web Standards for binary and encoding operations', () => {
    const srcDir = join(process.cwd(), 'src');
    const sourceFiles = getAllSourceFiles(srcDir);

    const bufferConstructorRegex = /\bBuffer\.from\b|\bBuffer\.alloc\b|\bnew Buffer\b/g;

    for (const filePath of sourceFiles) {
      const content = readFileSync(filePath, 'utf-8');
      const matches = content.match(bufferConstructorRegex);
      expect(matches).toBeNull();
    }
  });
});
