import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
        turns: [
          { type: 'chair', kind: 'opening', round: null, text: '開場白' },
          { type: 'debater', speaker: 'cto', kind: 'opening', round: null, text: 'Go語法簡單，兩週上手。' },
          { type: 'chair', kind: 'directive', round: 1, text: '指令' },
          { type: 'debater', speaker: 'cto', kind: 'rebuttal', round: 1, text: '回應一' },
          { type: 'chair', kind: 'directive', round: 2, text: '指令' },
          { type: 'debater', speaker: 'cto', kind: 'rebuttal', round: 2, text: '回應二' },
          { type: 'debater', speaker: 'cto', kind: 'closing', round: null, text: '結辯' },
        ],
        claims: { 'cto.1': { id: 'cto.1', status: 'open' } },
      })
    );

    writeFileSync(join(tmp, 'report.md'), '推薦方案：`go`');
    const res = auditRunDirectory(tmp);
    assert.equal(res.passed, true);
    assert.deepEqual(res.issues, []);
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
        turns: [{ type: 'debater', speaker: 'cto', kind: 'rebuttal', round: 1, text: '逐字稿裡只有簡單的發言。' }], // Only 1 round!
        claims: { 'cto.conceded': { id: 'cto.conceded', status: 'conceded' } },
      })
    );

    const res = auditRunDirectory(tmp);
    assert.equal(res.passed, false);
    const problems = res.issues.map((i) => i.problem);
    assert.ok(problems.some((p) => p.includes('與數學計算贏家 `go` 不一致')));
    assert.ok(problems.some((p) => p.includes('並非單一發言中的連續原文')));
    assert.ok(problems.some((p) => p.includes('已被讓步的論點作為支持證據')));
    assert.ok(problems.some((p) => p.includes('交叉質詢僅記錄了 1 輪')));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('auditRunDirectory detects real issues in the baseline run directory', () => {
  const baselineDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'evals', 'baseline-go-vs-rust');
  const res = auditRunDirectory(baselineDir);

  // In the baseline run:
  // 1. Cross examination only ran 1 round (or state.json was missing)
  // 2. Highlights quotes had splicing/rephrasing
  assert.ok(res.issues.length > 0);
});

function withRun(files, fn) {
  const tmp = mkdtempSync(join(tmpdir(), 'senate-audit-'));
  try {
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(tmp, name), typeof content === 'string' ? content : JSON.stringify(content));
    }
    return fn(auditRunDirectory(tmp));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

const turns = [
  { type: 'debater', speaker: 'conservative_cto', kind: 'opening', text: '凌晨三點誰起床修？新人兩週內要能上手。' },
  { type: 'debater', speaker: 'perf_zealot', kind: 'opening', text: 'p99 才是真相，平均值是謊言。' },
];

test('audit: highlight quotes may use … inside one turn but may not splice two turns', () => {
  withRun({
    'analysis.json': { winner: 'go', margin: 1, win_probability: { go: 0.9 } },
    'state.json': { turns, claims: {} },
    'input.json': { extras: { highlights: [
      { title: 'ok', speaker_id: 'conservative_cto', quote: '凌晨三點誰起床修？…兩週內要能上手' },
      { title: 'spliced', speaker_id: 'conservative_cto', quote: '新人兩週內要能上手。p99 才是真相' },
      { title: 'wrong speaker', speaker_id: 'conservative_cto', quote: '平均值是謊言' },
    ] } },
  }, (res) => {
    const locs = res.issues.map((i) => `${i.severity}:${i.location}`);
    assert.ok(!locs.includes('high:extras.highlights[0].quote'));
    assert.ok(locs.includes('high:extras.highlights[1].quote'));
    assert.ok(locs.includes('medium:extras.highlights[2].speaker_id'));
  });
});

test('audit: confidence band 50–75% must be 中, and stale analysis.json is detected', async () => {
  const { inputDigest } = await import('./analyze.mjs');
  const input = { options: [{ id: 'go' }], criteria: [{ id: 'c' }], chairSamples: [{ weights: { c: 1 }, cells: [{ option_id: 'go', criterion_id: 'c', score: 5 }] }],
    extras: { verdict: { recommended_option_id: 'go', confidence_label: '高' } } };
  const digest = inputDigest(input);
  input.chairSamples[0].cells[0].score = 9; // edited after analysis
  withRun({
    'analysis.json': { analysis: { winner: 'go', margin: 1, win_probability: { go: 0.6 }, input_digest: digest } },
    'input.json': input,
  }, (res) => {
    assert.ok(res.issues.some((i) => i.location === 'extras.verdict.confidence_label' && i.problem.includes('「中」')));
    assert.ok(res.issues.some((i) => i.problem.includes('不是由目前的 input.json 算出來的')));
    assert.equal(res.passed, false);
  });
});
