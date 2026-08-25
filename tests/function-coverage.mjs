// Function-level coverage report for the app's inline script.
//
// index.html is a single file with one big inline <script>, so standard
// file-based coverage tools have nothing to instrument. This runs the suite
// with FN_COVERAGE=1 (the harness then records every app function invoked
// through `window`) and reports which top-level functions are exercised.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { COVERAGE_DIR, declaredFunctions } from './harness.mjs';

fs.rmSync(COVERAGE_DIR, { recursive: true, force: true });

const run = spawnSync('npx', ['vitest', 'run'], {
  stdio: 'inherit',
  env: { ...process.env, FN_COVERAGE: '1' },
});

const covered = new Set();
if (fs.existsSync(COVERAGE_DIR)) {
  for (const file of fs.readdirSync(COVERAGE_DIR)) {
    for (const name of JSON.parse(fs.readFileSync(`${COVERAGE_DIR}/${file}`, 'utf8'))) {
      covered.add(name);
    }
  }
}
fs.rmSync(COVERAGE_DIR, { recursive: true, force: true });

const declared = declaredFunctions();
const missing = declared.filter((name) => !covered.has(name));
const percent = declared.length ? Math.round(((declared.length - missing.length) / declared.length) * 100) : 0;

console.log('\nindex.html function coverage');
console.log('─'.repeat(40));
console.log(`covered: ${declared.length - missing.length}/${declared.length} (${percent}%)`);
if (missing.length) console.log(`uncovered: ${missing.join(', ')}`);

process.exit(run.status ?? 1);
