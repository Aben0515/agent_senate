import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateDebateQuality } from './quality.mjs';

test('evaluateDebateQuality evaluates high-standard debate favorably', () => {
  const goodState = {
    brief: {
      options: [
        { id: 'go', label: 'Go 語言' },
        { id: 'rust', label: 'Rust 語言' },
      ],
    },
    turns: [
      {
        type: 'debater',
        kind: 'opening',
        speaker: 'conservative_cto',
        text: '我毫不猶豫選擇 Go 語言。理由是 3 人團隊首年需要 2 週內快速交付並節省 30 萬人月預算。',
      },
      {
        type: 'debater',
        kind: 'opening',
        speaker: 'perf_zealot',
        text: '我堅決推薦 Rust 語言。p99 延遲必須小於 5 毫秒，且雲端記憶體花費能降低 40%。',
      },
      {
        type: 'chair',
        kind: 'directive',
        text: '戰況總結：@Vex，請說明在 1,500 RPS 下 Go 的 GC 停頓真的會導致商業違約嗎？',
      },
      {
        type: 'debater',
        kind: 'rebuttal',
        speaker: 'perf_zealot',
        text: '【讓步 #cto.1】我承認日常連線數不高。\n> 【陳CTO #cto.1】2 週內交付。\n但是大資料報表匯出時需要零成本抽象。',
      },
      {
        type: 'debater',
        kind: 'closing',
        speaker: 'conservative_cto',
        text: '結辯：我最終維持推薦 Go。若創始 3 人均精通 Rust，我的建議為錯。',
      },
      {
        type: 'debater',
        kind: 'closing',
        speaker: 'perf_zealot',
        text: '結辯：我堅持推薦 Rust。若純做低頻內部 CRUD，Go 是安全選擇。',
      },
    ],
    claims: {
      'cto.1': { text: 'Go 上手快', status: 'conceded' },
      'vex.1': { text: 'Rust 延遲低', status: 'open' },
    },
    fact_checks: [
      { verdict: 'plausible' },
    ],
    fallacies: [],
  };

  const res = evaluateDebateQuality(goodState);
  assert.equal(res.passed, true);
  assert.ok(res.total_score >= 16);
  assert.equal(res.breakdown.zero_flattery, 2);
  assert.equal(res.breakdown.stance_clarity, 2);
});

test('evaluateDebateQuality penalizes flattery and vague openings', () => {
  const badState = {
    brief: { options: [{ id: 'go', label: 'Go' }] },
    turns: [
      {
        type: 'debater',
        kind: 'opening',
        speaker: 'cto',
        text: '這件事情其實各有優劣，看情況而定。',
      },
      {
        type: 'debater',
        kind: 'rebuttal',
        speaker: 'vex',
        text: '您說得有道理，我非常同意陳 CTO 的觀點。',
      },
    ],
    claims: {},
  };

  const res = evaluateDebateQuality(badState);
  assert.equal(res.passed, false);
  assert.equal(res.breakdown.stance_clarity, 0);
  assert.equal(res.breakdown.zero_flattery, 0);
});
