const glob = require('glob');
const { execFileSync } = require('child_process');

const tests = glob.sync('tests/**/*.test.js');
if (tests.length === 0) {
  console.error('No test files found in tests/**/*.test.js');
  process.exit(1);
}

const args = ['--test', '--test-concurrency=1', '--require', './tests/env.js', ...tests];
execFileSync(process.execPath, args, { stdio: 'inherit' });
