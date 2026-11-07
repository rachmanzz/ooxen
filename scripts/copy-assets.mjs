import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// tsc only emits compiled TS. Copy static assets (CSS) into dist so the
// published package ships them next to the compiled renderer.
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const assets = [
  ['src/renderer/html/ooxen.css', 'dist/renderer/html/ooxen.css'],
];

for (const [from, to] of assets) {
  mkdirSync(join(root, dirname(to)), { recursive: true });
  copyFileSync(join(root, from), join(root, to));
  console.log(`copied ${from} -> ${to}`);
}
