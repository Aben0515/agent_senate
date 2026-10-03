import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractJsonFromText,
  validateJudgeOutput,
  validatePersonaOutput,
  validateTurnMarkdown,
} from './validate.mjs';

const mockBrief = {
  options: [
    { id: 'go', label: 'Go' },
    { id: 'rust', label: 'Rust' },
  ],
  criteria: [
    { id: 'ops_simplicity', label: '維運簡單度' },
    { id: 'perf', label: '極致性能' },
  ],
};

const mockLedger = {
  claims: {
    'c1': { id: 'c1', status: 'open' },
    'c2': { id: 'c2', status: 'conceded' },
    'c3': { id: 'c3', status: 'disputed_fact' },
  },
};

test('extractJsonFromText parses clean and messy JSON with markdown fences and comments', () => {
  const clean = '{"a": 1, "b": "hello"}';
  assert.deepEqual(extractJsonFromText(clean), { a: 1, b: 'hello' });

  const fenced = '```json\n{"status": "ok",}\n```';
  assert.deepEqual(extractJsonFromText(fenced), { status: 'ok' });

  const messy = 'Here is your json output:\n{"count": 42,} Hope this helps!';
  assert.deepEqual(extractJsonFromText(messy), { count: 42 });
});

test('validateJudgeOutput accepts complete, valid scoring data', () => {
  const valid = {
    weights: { ops_simplicity: 0.6, perf: 0.4 },
    weight_rationale: { ops_simplicity: '3人維運重要', perf: '非極限性能' },
    cells: [
      { option_id: 'go', criterion_id: 'ops_simplicity', score: 9.0, rationale: '很好', evidence_claim_ids: ['c1'] },
      { option_id: 'go', criterion_id: 'perf', score: 7.0, rationale: '夠用', evidence_claim_ids: [] },
      { option_id: 'rust', criterion_id: 'ops_simplicity', score: 5.0, rationale: '較難', evidence_claim_ids: [] },
      { option_id: 'rust', criterion_id: 'perf', score: 10.0, rationale: '極佳', evidence_claim_ids: [] },
    ],
  };
  const res = validateJudgeOutput(mockBrief, valid, mockLedger);
  assert.equal(res.ok, true);
  assert.equal(res.errors.length, 0);
});

test('validateJudgeOutput catches missing cell slot', () => {
  const missingOne = {
    weights: { ops_simplicity: 0.6, perf: 0.4 },
    cells: [
      { option_id: 'go', criterion_id: 'ops_simplicity', score: 9.0, rationale: '很好' },
      // missing go|perf
      { option_id: 'rust', criterion_id: 'ops_simplicity', score: 5.0, rationale: '較難' },
      { option_id: 'rust', criterion_id: 'perf', score: 10.0, rationale: '極佳' },
    ],
  };
  const res = validateJudgeOutput(mockBrief, missingOne, mockLedger);
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.includes('缺少評合格子：`go|perf`')));
});

test('validateJudgeOutput catches duplicate slot', () => {
  const dup = {
    weights: { ops_simplicity: 0.6, perf: 0.4 },
    cells: [
      { option_id: 'go', criterion_id: 'ops_simplicity', score: 9.0, rationale: '好' },
      { option_id: 'go', criterion_id: 'ops_simplicity', score: 8.0, rationale: '重複' },
      { option_id: 'go', criterion_id: 'perf', score: 7.0, rationale: '好' },
      { option_id: 'rust', criterion_id: 'ops_simplicity', score: 5.0, rationale: '難' },
      { option_id: 'rust', criterion_id: 'perf', score: 10.0, rationale: '極佳' },
    ],
  };
  const res = validateJudgeOutput(mockBrief, dup, mockLedger);
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.includes('重複評分格子：`go|ops_simplicity`')));
});

test('validateJudgeOutput catches unknown criterion or option ID', () => {
  const badId = {
    weights: { ops_simplicity: 0.6, perf: 0.4, unknown_crit: 0.1 },
    cells: [
      { option_id: 'go', criterion_id: 'ops_simplicity', score: 9.0, rationale: '好' },
      { option_id: 'go', criterion_id: 'unknown_crit', score: 7.0, rationale: '好' },
      { option_id: 'rust', criterion_id: 'ops_simplicity', score: 5.0, rationale: '難' },
      { option_id: 'rust', criterion_id: 'perf', score: 10.0, rationale: '極佳' },
    ],
  };
  const res = validateJudgeOutput(mockBrief, badId, mockLedger);
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.includes('unknown_crit')));
});

test('validateJudgeOutput catches invalid score (out of 1-10 range or string)', () => {
  const badScore = {
    weights: { ops_simplicity: 0.6, perf: 0.4 },
    cells: [
      { option_id: 'go', criterion_id: 'ops_simplicity', score: 15.0, rationale: '好' },
      { option_id: 'go', criterion_id: 'perf', score: 'not_a_number', rationale: '好' },
      { option_id: 'rust', criterion_id: 'ops_simplicity', score: 0.5, rationale: '難' },
      { option_id: 'rust', criterion_id: 'perf', score: 10.0, rationale: '極佳' },
    ],
  };
  const res = validateJudgeOutput(mockBrief, badScore, mockLedger);
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.includes('必須在 1 到 10 之間')));
});

test('validateJudgeOutput catches evidence referencing conceded or disputed claims', () => {
  const badEvidence = {
    weights: { ops_simplicity: 0.6, perf: 0.4 },
    cells: [
      { option_id: 'go', criterion_id: 'ops_simplicity', score: 9.0, rationale: '好', evidence_claim_ids: ['c2'] }, // c2 is conceded
      { option_id: 'go', criterion_id: 'perf', score: 7.0, rationale: '好', evidence_claim_ids: ['c3'] }, // c3 is disputed_fact
      { option_id: 'rust', criterion_id: 'ops_simplicity', score: 5.0, rationale: '難', evidence_claim_ids: ['c99'] }, // c99 doesn't exist
      { option_id: 'rust', criterion_id: 'perf', score: 10.0, rationale: '極佳', evidence_claim_ids: [] },
    ],
  };
  const res = validateJudgeOutput(mockBrief, badEvidence, mockLedger);
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.includes('已被讓步的論點')));
  assert.ok(res.errors.some((e) => e.includes('已被查核判定可能錯誤')));
  assert.ok(res.errors.some((e) => e.includes('不存在於索引')));
});

test('validatePersonaOutput checks speaker_id and final_choice', () => {
  const personaScore = {
    speaker_id: 'conservative_cto',
    final_choice: 'go',
    weights: { ops_simplicity: 0.8, perf: 0.2 },
    cells: [
      { option_id: 'go', criterion_id: 'ops_simplicity', score: 9.0, reason: '好' },
      { option_id: 'go', criterion_id: 'perf', score: 6.0, reason: '普' },
      { option_id: 'rust', criterion_id: 'ops_simplicity', score: 4.0, reason: '難' },
      { option_id: 'rust', criterion_id: 'perf', score: 10.0, reason: '高' },
    ],
  };
  const res = validatePersonaOutput(mockBrief, personaScore, 'conservative_cto');
  assert.equal(res.ok, true);

  const wrongSpeaker = validatePersonaOutput(mockBrief, personaScore, 'perf_zealot');
  assert.equal(wrongSpeaker.ok, false);
  assert.ok(wrongSpeaker.errors.some((e) => e.includes('speaker_id 不符')));
});

test('validateTurnMarkdown checks claims block and kind validity', () => {
  const validMd = `
我是陳CTO，我認為 Go 很好。

\`\`\`claims
[
  { "text": "Go 兩週上手", "quote": "兩週上手", "kind": "estimate" },
  { "text": "TCO 低", "quote": "TCO 低", "kind": "value" }
]
\`\`\`
`;
  const res = validateTurnMarkdown(validMd, 'cto', mockLedger);
  assert.equal(res.ok, true);
  assert.equal(res.claims.length, 2);

  const invalidKindMd = `
發言內容...
\`\`\`claims
[
  { "text": "Go 兩週上手", "quote": "兩週上手", "kind": "concession" }
]
\`\`\`
`;
  const resInvalid = validateTurnMarkdown(invalidKindMd, 'cto', mockLedger);
  assert.equal(resInvalid.ok, false);
  assert.ok(resInvalid.errors.some((e) => e.includes('kind `concession` 無效')));
});
