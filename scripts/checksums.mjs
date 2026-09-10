/**
 * Regenerate FINAL_CHECKSUMS.txt.
 *
 * Run this last, after every other file is final. `npm run verify` then
 * requires the manifest to cover every tracked file and match it byte for byte.
 *
 *   node scripts/checksums.mjs
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set([
  'node_modules', 'dist', '.git', '.vite', '__pycache__', '.pytest_cache',
  'artifacts', '.venv',
]);
const SKIP_FILES = new Set(['FINAL_CHECKSUMS.txt', 'package-lock.json']);

function walk(dir, out = []) {
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (!SKIP_DIRS.has(name)) walk(path, out);
      continue;
    }
    if (name.endsWith('.pyc') || name.endsWith('.tsbuildinfo')) continue;
    out.push(path);
  }
  return out;
}

const lines = walk(root)
  .map((path) => relative(root, path).split('\\').join('/'))
  .filter((name) => !SKIP_FILES.has(name))
  .sort()
  .map((name) => `${createHash('sha256').update(readFileSync(join(root, name))).digest('hex')}  ${name}`);

writeFileSync(join(root, 'FINAL_CHECKSUMS.txt'), lines.join('\n') + '\n');
console.log(`Wrote FINAL_CHECKSUMS.txt with ${lines.length} entries.`);
