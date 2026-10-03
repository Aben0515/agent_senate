import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { openSync, closeSync, readFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';

function runCli(scriptPath, args = []) {
  const nonce = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const outPath = join(process.cwd(), `tmp_${nonce}_out.txt`);
  const errPath = join(process.cwd(), `tmp_${nonce}_err.txt`);

  const outFd = openSync(outPath, 'w');
  const errFd = openSync(errPath, 'w');

  const res = spawnSync(process.execPath, [scriptPath, ...args], {
    stdio: ['ignore', outFd, errFd],
  });

  closeSync(outFd);
  closeSync(errFd);

  const stdout = existsSync(outPath) ? readFileSync(outPath, 'utf-8') : '';
  const stderr = existsSync(errPath) ? readFileSync(errPath, 'utf-8') : '';

  if (existsSync(outPath)) unlinkSync(outPath);
  if (existsSync(errPath)) unlinkSync(errPath);

  return { status: res.status, stdout, stderr, error: res.error };
}

test('CLI entrypoints: print usage and exit with code 2 when invoked without arguments', () => {
  const scripts = [
    { name: 'audit.mjs', expected: '用法：node audit.mjs' },
    { name: 'ledger.mjs', expected: '用法：node ledger.mjs' },
    { name: 'report.mjs', expected: '用法：node report.mjs' },
    { name: 'validate.mjs', expected: '用法：node validate.mjs' },
    { name: 'quality.mjs', expected: '用法：node quality.mjs' },
    { name: 'analyze.mjs', expected: 'usage: node analyze.mjs' },
  ];

  for (const s of scripts) {
    const fullPath = join(process.cwd(), 'skills', 'agent-senate', 'scripts', s.name);
    const res = runCli(fullPath, []);
    assert.equal(res.status, 2, `Script ${s.name} should exit with code 2 on missing args, got ${res.status}`);
    const output = (res.stderr + res.stdout).toLowerCase();
    assert.ok(
      output.includes(s.expected.toLowerCase()),
      `Script ${s.name} output should include '${s.expected}', got: ${output}`
    );
  }
});

test('CLI audit.mjs on baseline returns exit code 1 (fails audit on quote splicing)', () => {
  const auditScript = join(process.cwd(), 'skills', 'agent-senate', 'scripts', 'audit.mjs');
  const baselineDir = join(process.cwd(), 'evals', 'baseline-go-vs-rust');

  const res = runCli(auditScript, [baselineDir]);
  assert.equal(res.status, 1, `audit.mjs on baseline should exit with code 1, got ${res.status}`);
  const jsonOutput = JSON.parse(res.stdout);
  assert.equal(jsonOutput.passed, false);
  assert.ok(jsonOutput.issues.length >= 2, 'Should detect real quote splicing issues');
});
