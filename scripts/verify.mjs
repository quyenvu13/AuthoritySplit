/**
 * Repository integrity and hygiene gate.
 *
 * Nothing here is hardcoded twice. The contract hash is computed from the file
 * and every other pinned value is required to agree with it, so this script
 * fails if the contract, the frontend config, or the checksum manifest ever
 * drift apart.
 *
 *   node scripts/verify.mjs
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const SKIP_DIRS = new Set([
  'node_modules', 'dist', '.git', '.vite', '__pycache__', '.pytest_cache',
  'artifacts', '.venv',
]);
const SKIP_FILES = new Set(['FINAL_CHECKSUMS.txt', 'package-lock.json']);

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
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

const problems = [];
function check(condition, message) {
  if (!condition) problems.push(message);
}

/* 1. contract hash, and everything that claims to know it ----------------- */

const contractPath = join(root, 'contracts', 'AuthoritySplit.py');
const contractSource = readFileSync(contractPath, 'utf8');
const contractSha = sha256(contractPath);

const contractVersion = /CONTRACT_VERSION\s*=\s*"([^"]+)"/.exec(contractSource)?.[1];
check(Boolean(contractVersion), 'CONTRACT_VERSION not found in the contract source');

const config = readFileSync(join(root, 'src', 'config.ts'), 'utf8');
check(
  config.includes(contractSha),
  `src/config.ts does not declare the current contract hash ${contractSha}`,
);
check(
  config.includes(`EXPECTED_CONTRACT_VERSION = '${contractVersion}'`),
  `src/config.ts expects a different contract version than the contract's ${contractVersion}`,
);

const budget = /MAX_SEMANTIC_EVALS_PER_AGREEMENT\s*=\s*(\d+)/.exec(contractSource)?.[1];
check(
  config.includes(`EXPECTED_SEMANTIC_BUDGET = ${budget}`),
  `src/config.ts expects a different semantic budget than the contract's ${budget}`,
);

/* 2. no build output shipped inside the package -------------------------- */

const tracked = walk(root).map((path) => relative(root, path));

for (const dir of ['dist', '.vite', '__pycache__', '.pytest_cache', 'artifacts']) {
  check(
    !existsSync(join(root, dir)),
    `${dir}/ is present at the package root — it must not be shipped`,
  );
}
check(
  !existsSync(join(root, 'contracts', '__pycache__')),
  'contracts/__pycache__/ is present — it must not be shipped',
);
check(
  !existsSync(join(root, 'tests', 'direct', '__pycache__')),
  'tests/direct/__pycache__/ is present — it must not be shipped',
);

/* 3. no absolute developer paths leaked into tracked text ---------------- */

const TEXTUAL = /\.(py|ts|tsx|js|mjs|json|md|css|html|txt|yml|yaml|svg)$/i;
const LEAKED_PATH = /(^|[\s"'`(])(\/(home|Users)\/[A-Za-z0-9._-]+|[A-Z]:\\Users\\)/;

for (const name of tracked) {
  if (!TEXTUAL.test(name)) continue;
  const lines = readFileSync(join(root, name), 'utf8').split('\n');
  const hit = lines.findIndex((line) => LEAKED_PATH.test(line));
  if (hit >= 0) problems.push(`${name}:${hit + 1} contains an absolute developer path`);
}

/* 4. checksum manifest covers every tracked file, and matches -------------- */

const manifestPath = join(root, 'FINAL_CHECKSUMS.txt');
if (!existsSync(manifestPath)) {
  problems.push('FINAL_CHECKSUMS.txt is missing');
} else {
  const manifest = new Map();
  for (const line of readFileSync(manifestPath, 'utf8').split('\n')) {
    const match = /^([0-9a-f]{64})\s+(.+)$/.exec(line.trim());
    if (match) manifest.set(match[2].replace(/\//g, sep), match[1]);
  }

  const expected = tracked.filter((name) => !SKIP_FILES.has(name));
  for (const name of expected) {
    const recorded = manifest.get(name);
    if (!recorded) {
      problems.push(`${name} is not covered by FINAL_CHECKSUMS.txt`);
    } else if (recorded !== sha256(join(root, name))) {
      problems.push(`${name} does not match its recorded checksum`);
    }
  }
  for (const name of manifest.keys()) {
    if (!expected.includes(name)) problems.push(`${name} is in the manifest but not in the repository`);
  }
}

/* ------------------------------------------------------------------------- */

if (problems.length) {
  console.error('AuthoritySplit verification FAIL');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log('AuthoritySplit verification PASS');
console.log(`Contract SHA256:  ${contractSha}`);
console.log(`Contract version: ${contractVersion}`);
console.log(`Files covered:    ${tracked.filter((n) => !SKIP_FILES.has(n)).length}`);
