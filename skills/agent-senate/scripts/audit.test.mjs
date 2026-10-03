import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { auditRunDirectory, normalizeText } from './audit.mjs';

test('normalizeText strips spaces and punctuations for robust matching', () => {
  const t1 = '「慢不是 bug，是商業模式的漏洞。」';
  const t2 = '慢不是bug是商業模式的漏洞';
  assert.equal(normalizeText(t1), normalizeText(t2));
});

test('auditRunDirectory passes on clean, consistent run data', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'senate-audit-test-'));
  try {
    writeFileSync(
      join(tmp, 'analysis.json'),
      JSON.stringify({
        winner: 'go',
        margin: 1.5,
        win_probability: { go: 0.85, rust: 0.15 },
      })
    );
    writeFileSync(
      join(tmp, 'input.json'),
      JSON.stringify({
        extras: {
          verdict: { recommended_option_id: 'go', confidence_label: '高' },
          highlights: [{ title: '經典', quote: 'Go語法簡單', speaker_id: 'cto' }],
        },
      })
    );
    writeFileSync(
      join(tmp, 'transcript.md'),
      '### ⚖️ 天秤主席\n開場白\n### cto\nGo語法簡單，兩週上手。\n### ⚖️ 天秤主席\n指令'
    );
    writeFileSync(
      join(tmp, 'state.json'),
      JSON.stringify({
        turns: [{ round: 1 }, { round: 2 }],
        claims: { 'cto.1': { id: 'cto.1', status: 'open' } },
      })
    );

    const res = auditRunDirectory(tmp);
    assert.equal(res.passed, true);
    assert.equal(res.issues.filter((i) => i.severity === 'high').length, 0);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('auditRunDirectory catches winner mismatch, fake quotes, and conceded evidence', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'senate-audit-bad-'));
  try {
    writeFileSync(
      join(tmp, 'analysis.json'),
      JSON.stringify({
        winner: 'go',
        margin: 1.5,
        win_probability: { go: 0.85 },
      })
    );
    writeFileSync(
      join(tmp, 'input.json'),
      JSON.stringify({
        chairSamples: [
          {
            cells: [{ option_id: 'go', criterion_id: 'c1', evidence_claim_ids: ['cto.conceded'] }],
          },
        ],
        extras: {
          verdict: { recommended_option_id: 'rust', confidence_label: '低' }, // Mismatch!
          highlights: [{ title: '拼接金句', quote: '這句話根本沒出現在逐字稿裡完全捏造' }],
        },
      })
    );
    writeFileSync(join(tmp, 'transcript.md'), '逐字稿裡只有簡單的發言。');
    writeFileSync(
      join(tmp, 'state.json'),
      JSON.stringify({
        turns: [{ round: 1 }], // Only 1 round!
        claims: { 'cto.conceded': { id: 'cto.conceded', status: 'conceded' } },
      })
    );

    const res = auditRunDirectory(tmp);
    assert.equal(res.passed, false);
    const problems = res.issues.map((i) => i.problem);
    assert.ok(problems.some((p) => p.includes('與數學計算贏家 `go` 不一致')));
    assert.ok(problems.some((p) => p.includes('並非逐字稿中的連續原文')));
    assert.ok(problems.some((p) => p.includes('已被讓步的論點作為支持證據')));
    assert.ok(problems.some((p) => p.includes('交叉質詢僅記錄了 1 輪')));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('auditRunDirectory detects real issues in the baseline run directory', () => {
  const baselineDir = './evals/baseline-go-vs-rust';
  const res = auditRunDirectory(baselineDir);
  console.log('Audit results on baseline:', JSON.stringify(res, null, 2));

  // In the baseline run:
  // 1. Cross examination only ran 1 round (or state.json was missing)
  // 2. Highlights quotes had splicing/rephrasing
  assert.ok(res.issues.length > 0);
});
