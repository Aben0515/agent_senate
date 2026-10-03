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
  assert.ok(indexText.includes('#cto.1'));
  assert.ok(indexText.includes('💔已讓步'));
  assert.ok(indexText.includes('#vex.1'));
  assert.ok(indexText.includes('✅合理'));

  // 10. Verify transcript output includes chair speeches and directives
  const transcript = generateTranscriptMarkdown(state);
  assert.ok(transcript.includes('### ⚖️ 天秤主席 ｜ opening'));
  assert.ok(transcript.includes('### ⚖️ 天秤主席 ｜ directive (第 1 輪)'));
  assert.ok(transcript.includes('### conservative_cto ｜ opening'));
  assert.ok(transcript.includes('最終論點索引表'));
  assert.ok(transcript.includes('辯手計分板'));
});
