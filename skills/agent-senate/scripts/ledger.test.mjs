import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialState,
  addChairTurn,
  addDebaterTurn,
  recordFactChecks,
  recordFallacies,
  renderClaimsIndex,
  computeScoreboard,
  generateTranscriptMarkdown,
} from './ledger.mjs';

test('ledger manages turns, claim prefixes, concessions, and scoreboard', () => {
  const brief = {
    restated_question: '3 人新創該選 Go 還是 Rust？',
    options: [{ id: 'go', label: 'Go' }, { id: 'rust', label: 'Rust' }],
    context_facts: ['3 人團隊熟 Python'],
  };

  const state = createInitialState(brief.restated_question, brief);

  // 1. Chair opening
  addChairTurn(state, {
    kind: 'opening',
    text: '歡迎來到圓桌辯論室。',
  });
  assert.equal(state.turns.length, 1);
  assert.equal(state.turns[0].type, 'chair');

  // 2. CTO opening turn with claim
  const ctoTurn = `
我支持 Go。理由是開發速度快。

\`\`\`claims
[
  {
    "text": "Go 學習成本低，兩週上手",
    "quote": "開發速度快",
    "kind": "estimate",
    "supports_option_ids": ["go"]
  }
]
\`\`\`
`;
  const res1 = addDebaterTurn(state, {
    speaker: 'conservative_cto',
    kind: 'opening',
    text: ctoTurn,
  });
  assert.equal(res1.new_claims.length, 1);
  assert.equal(res1.new_claims[0].id, 'cto.1');
  assert.equal(state.claims['cto.1'].status, 'open');

  // 3. Vex opening turn attacking cto.1
  const vexTurn = `
我支持 Rust。
> 【陳CTO #cto.1】開發速度快。但是記憶體安全性更重要。

\`\`\`claims
[
  {
    "text": "Rust 記憶體零安全漏洞",
    "quote": "記憶體安全性更重要",
    "kind": "fact",
    "supports_option_ids": ["rust"],
    "attacks_claim_ids": ["cto.1"]
  }
]
\`\`\`
`;
  const res2 = addDebaterTurn(state, {
    speaker: 'perf_zealot',
    kind: 'opening',
    text: vexTurn,
  });
  assert.equal(res2.new_claims[0].id, 'vex.1');
  // cto.1 should now be attacked
  assert.equal(state.claims['cto.1'].status, 'attacked');
  assert.ok(state.claims['cto.1'].attacked_by.includes('vex.1'));

  // 4. Chair directive round 1
  addChairTurn(state, {
    kind: 'directive',
    round: 1,
    text: '請 CTO 回應 Vex 關於記憶體安全的質疑。',
  });

  // 5. CTO rebuttal with explicit in-text concession: 【讓步 #cto.1】
  const ctoRebuttal = `
【讓步 #cto.1】我承認 Go 確實有空指標風險，但 B2B 業務初期活下來最重要。

\`\`\`claims
[
  {
    "text": "初期生存優先於極限安全",
    "quote": "活下來最重要",
    "kind": "value",
    "supports_option_ids": ["go"],
    "concedes_claim_ids": ["cto.1"]
  }
]
\`\`\`
`;
  addDebaterTurn(state, {
    speaker: 'conservative_cto',
    kind: 'rebuttal',
    round: 1,
    text: ctoRebuttal,
  });
  assert.equal(state.claims['cto.1'].status, 'conceded');

  // 6. Fact check on vex.1
  recordFactChecks(state, [
    { claim_id: 'vex.1', verdict: 'plausible', note: '編譯期確實保證記憶體安全' },
  ]);
  assert.equal(state.claims['vex.1'].status, 'plausible');

  // 7. Fallacy on vex
  recordFallacies(state, [
    { claim_id: 'vex.1', speaker_id: 'perf_zealot', type: 'scale_mismatch', explanation: '拿 Discord 規模論證 3 人新創' },
  ]);

  // 8. Verify scoreboard
  const board = computeScoreboard(state);
  assert.ok(board['conservative_cto']);
  assert.ok(board['perf_zealot']);
  assert.equal(board['conservative_cto'].concessions_made, 1);
  assert.equal(board['perf_zealot'].attacks_landed, 1); // target cto.1 was conceded
  assert.equal(board['perf_zealot'].fallacies_flagged, 1);

  // 9. Verify claims index output
  const indexText = renderClaimsIndex(state);
  assert.ok(indexText.includes('- cto.1 ('));
  assert.ok(indexText.includes('💔已讓步'));
  assert.ok(indexText.includes('- vex.1 ('));
  assert.ok(indexText.includes('✅合理'));

  // 10. Verify transcript output includes chair speeches and directives
  const transcript = generateTranscriptMarkdown(state);
  assert.ok(transcript.includes('### ⚖️ 天秤主席 ｜ 開場陳述'));
  assert.ok(transcript.includes('### ⚖️ 天秤主席 ｜ 主席指令（第 1 輪）'));
  assert.ok(transcript.includes('### 🛡️ 陳CTO ｜ 開場陳述'));
  assert.ok(transcript.includes('### 🔎 事實查核'));
  assert.ok(transcript.includes('最終論點索引表'));
  assert.ok(transcript.includes('辯手計分板'));
});

const briefGoRust = { options: [{ id: 'go', label: 'Go' }, { id: 'rust', label: 'Rust' }] };
const claims = (arr) => '\n```claims\n' + JSON.stringify(arr) + '\n```\n';

test('ledger accepts the claim format that prompts.md template A asks for (supports/attacks/concedes, no quote)', () => {
  const state = createInitialState('q', briefGoRust);
  addDebaterTurn(state, { speaker: 'conservative_cto', kind: 'opening', text: '選 Go。兩週上手。' + claims([{ id: 'cto.1', text: 'Go 兩週上手', kind: 'estimate', supports: ['go'] }]) });
  const res = addDebaterTurn(state, {
    speaker: 'perf_zealot', kind: 'rebuttal', round: 1,
    text: '> 【陳CTO #cto.1】兩週上手\n兩週只夠寫 hello world。' + claims([{ id: 'vex.1', text: '兩週不夠', kind: 'estimate', supports: ['rust'], attacks: ['cto.1'], concedes: [] }]),
  });
  assert.equal(res.new_claims[0].id, 'vex.1');
  assert.deepEqual(res.new_claims[0].supports_option_ids, ['rust']);
  assert.deepEqual(res.new_claims[0].attacks_claim_ids, ['cto.1']);
  assert.equal(state.claims['cto.1'].status, 'attacked');
  assert.equal(state.claims['cto.1'].quote, 'Go 兩週上手', 'missing quote falls back to text');
});

test('in-text reference parsing: strict ids, no false positives, concessions are not attacks', async () => {
  const { parseInTextRefs } = await import('./common.mjs');
  assert.deepEqual(parseInTextRefs('【cto.1】').references, ['cto.1']);
  assert.deepEqual(parseInTextRefs('> 【陳CTO #cto.12】原話').references, ['cto.12']);
  assert.deepEqual(parseInTextRefs('【Rust】【重點】【Go 生態】').references, []);
  const r = parseInTextRefs('【讓步 #vex.2】我承認');
  assert.deepEqual(r.concessions, ['vex.2']);
  assert.deepEqual(r.references, []);
});

test('conceding an opponent claim is an acknowledgement, not a withdrawal of their claim', () => {
  const state = createInitialState('q', briefGoRust);
  addDebaterTurn(state, { speaker: 'cto', kind: 'opening', text: 'Go。' + claims([{ text: 'Go 招募池大', quote: 'Go', kind: 'fact' }]) });
  const res = addDebaterTurn(state, { speaker: 'vex', kind: 'rebuttal', round: 1, text: '【讓步 #cto.1】招募池確實大。' + claims([]) });
  assert.equal(state.claims['cto.1'].status, 'open', 'opponent claim must stay usable as evidence');
  assert.deepEqual(state.claims['cto.1'].acknowledged_by, ['perf_zealot']);
  assert.ok(res.warnings.some((w) => w.includes('承認對手論點')));
});

test('a concession in a turn with no new claims (empty claims block) still marks the own claim conceded', () => {
  const state = createInitialState('q', briefGoRust);
  addDebaterTurn(state, { speaker: 'perf_zealot', kind: 'opening', text: 'Rust。' + claims([{ text: 'p99 差 10 倍', quote: 'Rust', kind: 'estimate' }]) });
  addDebaterTurn(state, { speaker: 'perf_zealot', kind: 'rebuttal', round: 1, text: '【讓步 ＃vex.1：推算有誤】這個數字我收回。' + claims([]) });
  assert.equal(state.claims['vex.1'].status, 'conceded');
});

test('attacking a claim does not erase a likely_false fact-check verdict', () => {
  const state = createInitialState('q', briefGoRust);
  addDebaterTurn(state, { speaker: 'vex', kind: 'opening', text: 'Rust 快。' + claims([{ text: 'Rust 快 100 倍', quote: 'Rust 快', kind: 'fact' }]) });
  recordFactChecks(state, [{ claim_id: 'vex.1', verdict: 'likely_false', note: '誇大' }], { round: 1 });
  addDebaterTurn(state, { speaker: 'cto', kind: 'rebuttal', round: 1, text: '亂講。' + claims([{ text: '沒有 100 倍', quote: '亂講', kind: 'value', attacks: ['vex.1'] }]) });
  assert.equal(state.claims['vex.1'].status, 'disputed_fact');
  assert.equal(computeScoreboard(state).conservative_cto.attacks_landed, 0, 'piling onto an already-disputed claim is not a landed attack');
  // Attack first, fact-check later → counts once, however many claims attacked it.
  addDebaterTurn(state, { speaker: 'vex', kind: 'rebuttal', round: 1, text: 'Go 慢。' + claims([{ text: 'Go 慢', quote: 'Go 慢', kind: 'fact' }]) });
  addDebaterTurn(state, { speaker: 'cto', kind: 'rebuttal', round: 2, text: '不慢。' + claims([
    { text: '不慢', quote: '不慢', kind: 'value', attacks: ['vex.2'] },
    { text: '真的不慢', quote: '不慢', kind: 'value', attacks: ['#VEX.2'] },
  ]) });
  recordFactChecks(state, [{ claim_id: '[vex.2]', verdict: 'likely_false' }], { round: 2 });
  assert.equal(state.claims['vex.2'].status, 'disputed_fact', 'fact-check ids are normalised');
  assert.equal(computeScoreboard(state).conservative_cto.attacks_landed, 1);
});

test('an invalid turn leaves the ledger untouched and aliases map to canonical ids', () => {
  const state = createInitialState('q', briefGoRust);
  assert.throws(() => addDebaterTurn(state, { speaker: 'cto', kind: 'opening', text: 'x' + claims([{ text: 'a', kind: 'concession' }]) }), /無效的 claim kind/);
  assert.equal(Object.keys(state.claims).length, 0);
  assert.equal(state.turns.length, 0);
  assert.equal(state.speaker_counters.cto ?? 0, 0);
  addDebaterTurn(state, { speaker: 'CTO', kind: 'opening', text: 'x' + claims([{ text: 'a', quote: 'x', kind: 'value' }]) });
  assert.equal(state.claims['cto.1'].speaker, 'conservative_cto');
  recordFallacies(state, [{ claim_id: 'cto.1', type: 'appeal_to_authority' }]);
  assert.equal(computeScoreboard(state).conservative_cto.fallacies_flagged, 1, 'speaker inferred from claim id');
});

test('ledger rejects turns that would silently lose data, and facts/fallacies are all-or-nothing', () => {
  const state = createInitialState('q', briefGoRust);
  assert.throws(() => addDebaterTurn(state, { speaker: 'cto', kind: 'opening', text: '選 Go，沒附 claims。' }), /必須在末尾附上/);
  assert.throws(() => addDebaterTurn(state, { speaker: 'cto', kind: 'opening', text: '選 Go\n```claims\n[{"text":"a","kind":"value"' }), /沒有結尾/);
  assert.throws(() => addDebaterTurn(state, { speaker: 'cto', kind: 'rebutal', round: 1, text: 'x' + claims([]) }), /未知的發言類型/);
  assert.throws(() => addDebaterTurn(state, { speaker: 'cto', kind: 'rebuttal', text: 'x' + claims([]) }), /--round/);
  assert.throws(() => addChairTurn(state, { kind: 'directives', round: 1, text: 'x' }), /未知的主席發言類型/);
  assert.equal(state.turns.length, 0);

  const res = addDebaterTurn(state, { speaker: 'cto', kind: 'opening', text: '選 Go。\n```json\n[{"text":"Go 好","quote":"選 Go","kind":"value"}]\n```' });
  assert.deepEqual(res.new_claims.map((c) => c.id), ['cto.1'], '```json fence accepted as a fallback');
  assert.ok(res.warnings.some((w) => w.includes('```json')));

  assert.throws(() => recordFactChecks(state, [{ claim_id: 'cto.1', verdict: 'likely_false' }, { claim_id: 'cto.9', verdict: 'plausible' }]), /不存在於索引/);
  assert.equal(state.claims['cto.1'].status, 'open', 'nothing recorded when one check is bad');
  assert.throws(() => recordFallacies(state, [{ claim_id: 'zzz.1', type: 'x' }]), /不存在/);
  assert.equal(state.fallacies.length, 0);
});

test('steelman and closing quotes are not recorded as attacks', () => {
  const state = createInitialState('q', briefGoRust);
  addDebaterTurn(state, { speaker: 'vex', kind: 'opening', text: 'Rust。' + claims([{ text: 'p99 穩', quote: 'Rust', kind: 'value' }]) });
  addDebaterTurn(state, { speaker: 'cto', kind: 'steelman', text: '> 【Vex #vex.1】p99 穩\n他說得有道理的部分是…' });
  assert.equal(state.claims['vex.1'].status, 'open');
  assert.deepEqual(state.claims['vex.1'].attacked_by, []);
});
