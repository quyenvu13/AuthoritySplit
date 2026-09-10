/**
 * Run a Python command with whichever interpreter this machine actually has.
 *
 * `python3` does not exist on a default Windows install, and the name that does
 * exist there (`python`, or the `py` launcher) is not what a Linux box has. A
 * reviewer should not have to edit package.json to run the suite, so this picks
 * the first interpreter that answers `--version` and reports 3.12 or newer.
 *
 *   node scripts/py.mjs -m pytest tests/direct -q
 */
import { spawnSync } from 'node:child_process';

const CANDIDATES =
  process.platform === 'win32'
    ? [['py', ['-3']], ['python', []], ['python3', []]]
    : [['python3', []], ['python', []]];

function usable(command, prefix) {
  const probe = spawnSync(command, [...prefix, '--version'], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  if (probe.status !== 0) return null;
  const text = `${probe.stdout || ''}${probe.stderr || ''}`;
  const match = /Python (\d+)\.(\d+)/.exec(text);
  if (!match) return null;
  const [, major, minor] = match.map(Number);
  if (major !== 3 || minor < 12) return null;
  return text.trim();
}

let chosen = null;
for (const [command, prefix] of CANDIDATES) {
  const version = usable(command, prefix);
  if (version) {
    chosen = { command, prefix, version };
    break;
  }
}

if (!chosen) {
  console.error(
    'No Python 3.12+ interpreter was found.\n' +
      'The GenLayer toolchain requires Python 3.12 or newer:\n' +
      '  https://www.python.org/downloads/\n' +
      'Then install the pinned tools:\n' +
      '  pip install -r requirements.txt\n' +
      'The JavaScript-only checks still work without it:\n' +
      '  npm run verify && npm run build',
  );
  process.exit(1);
}

const result = spawnSync(chosen.command, [...chosen.prefix, ...process.argv.slice(2)], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
process.exit(result.status === null ? 1 : result.status);
