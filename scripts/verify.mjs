import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const expectedContractSha = 'ce722d4e1708b900ceff3fa8d3ff2233a12f2e3315911dda88e0ccc65c9b2139';
const expectedProjectAddress = '0xA614c22Ea5bF0bAc17338a9539514fa6d2b050Ef';
const expectedRuntimeAddress = '0xD7E04011737411f02315D1864956Ec739049ccf1';

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (['node_modules', 'dist', '.git'].includes(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

const contractPath = join(root, 'contracts', 'SelfJudgingGuard.py');
const actual = sha256(contractPath);
if (actual !== expectedContractSha) {
  throw new Error(`Contract hash mismatch: ${actual}`);
}

const config = readFileSync(join(root, 'src', 'config.ts'), 'utf8');
for (const required of [expectedProjectAddress, expectedRuntimeAddress, expectedContractSha, "EXPECTED_CONTRACT_VERSION = '1.2'"]) {
  if (!config.includes(required)) throw new Error(`Missing pinned config value: ${required}`);
}

const files = walk(root);
const forbiddenArtifacts = files
  .map((path) => relative(root, path))
  .filter((name) => /(^|[\\/])(dist|node_modules|\.vite)([\\/]|$)/i.test(name));
if (forbiddenArtifacts.length) throw new Error(`Generated artifacts present: ${forbiddenArtifacts.join(', ')}`);

console.log('AuthoritySplit project verification PASS');
console.log(`Contract SHA256: ${actual}`);
console.log(`Project address: ${expectedProjectAddress}`);
console.log(`Runtime evidence: ${expectedRuntimeAddress}`);
