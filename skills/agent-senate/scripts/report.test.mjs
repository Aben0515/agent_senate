import test from 'node:test';
import assert from 'node:assert/strict';
import { generateReportMarkdown } from './report.mjs';

test('generateReportMarkdown produces structured, accurate report with dual persona tables', () => {
  const analysis = {
    winner: 'go',
    margin: 4.48,
    totals: { go: 8.82, rust: 4.34 },
    win_probability: { go: 1.0, rust: 0.0 },
    tipping_points: [
      {
        criterion_id: 'resource_efficiency',
        criterion_label: '資源效率與硬體成本',
        current_weight: 0.05,
        threshold: 0.619,
        direction: 'increase',
        new_winner: 'rust',
      },
    ],
    persona_lens: {
      cto: { winner: 'go', totals: { go: 8.87, rust: 3.53 } },
      vex: { winner: 'rust', totals: { go: 7.55, rust: 7.65 } },
    },
    persona_own_view: {
      cto: { winner: 'go', totals: { go: 9.0, rust: 3.0 } },
      vex: { winner: 'rust', totals: { go: 6.0, rust: 9.5 } },
    },
    matrix: {
      weights: { delivery: 0.6, resource_efficiency: 0.4 },
      cells: [
        { option_id: 'go', criterion_id: 'delivery', score: 9.0, rationale: 'Go快速' },
        { option_id: 'rust', criterion_id: 'delivery', score: 4.0, rationale: 'Rust較慢' },
        { option_id: 'go', criterion_id: 'resource_efficiency', score: 7.0, rationale: 'GC適中' },
        { option_id: 'rust', criterion_id: 'resource_efficiency', score: 10.0, rationale: '極致性能' },
      ],
    },
  };

  const state = {
    question: '3 人新創該選 Go 還是 Rust？',
    brief: {
      options: [
        { id: 'go', label: 'Go 語言' },
        { id: 'rust', label: 'Rust 語言' },
      ],
      criteria: [
        { id: 'delivery', label: '交付與迭代速度' },
        { id: 'resource_efficiency', label: '資源效率與硬體成本' },
      ],
    },
    turns: [],
    claims: {},
    speaker_counters: {},
    fallacies: [],
    fact_checks: [],
  };

  const extras = {
    verdict: {
      one_liner: '在生存期速度優先。',
      recommendation_text: '建議首年全面投入 Go。',
      confidence_label: '高',
    },
    key_tradeoffs: [{ title: '速度 vs 極致控制', gain: '快上線', cost: '少微秒延遲' }],
  };

  const report = generateReportMarkdown(analysis, state, extras);

  // Assert essential elements exist
  assert.ok(report.includes('推薦方案：Go 語言（`go`）'));
  assert.ok(report.includes('模擬勝率：100%'));
  assert.ok(report.includes('加權總分：8.82'));
  assert.ok(report.includes('領先幅度：4.48 分'));
  assert.ok(report.includes('| `delivery` | 交付與迭代速度 | **60%** | 9.0 | 4.0 |'));
  assert.ok(report.includes('各人格價值觀視角（Persona Lens：辯手權重 × 中立評審分數）'));
  assert.ok(report.includes('辯手主觀立場評分（Persona Own View：辯手權重 × 辯手自己的分數）'));
  assert.ok(report.includes('資源效率與硬體成本'));
  assert.ok(report.includes('**62%** 以上'));
  assert.ok(report.includes('一句話總結'));
  assert.ok(!report.includes('undefined'));
});

test('generateReportMarkdown survives missing extras and escapes special characters in cells', () => {
  const analysis = {
    winner: 'go',
    margin: 1.0,
    minimax_regret_option: 'go',
    totals: { go: 8.0 },
    win_probability: { go: 0.8 },
  };
  const state = {
    question: '問題帶有 | 管道符號',
    brief: {
      options: [{ id: 'go', label: 'Go | Special' }],
      criteria: [{ id: 'c1', label: '準則\n帶換行' }],
    },
    turns: [],
    claims: {},
  };

  const report = generateReportMarkdown(analysis, state, {});
  assert.ok(report.includes('推薦方案：Go | Special（`go`）'));
  assert.ok(report.includes('Go \\| Special'));
  assert.ok(!report.includes('undefined'));
});

const baseAnalysis = () => ({
  matrix: {
    options: [{ id: 'go', label: 'Go' }, { id: 'rust', label: 'Rust' }],
    criteria: [{ id: 'speed', label: '交付速度' }, { id: 'perf', label: '性能' }],
    weights: { speed: 0.7, perf: 0.3 },
    cells: [
      { option_id: 'go', criterion_id: 'speed', score: 8, rationale: '快' },
      { option_id: 'go', criterion_id: 'perf', score: 6, rationale: '夠' },
      { option_id: 'rust', criterion_id: 'speed', score: 5, rationale: '慢' },
      { option_id: 'rust', criterion_id: 'perf', score: 9, rationale: '強' },
    ],
    persona_scores: [{ speaker_id: 'perf_zealot', final_choice: 'rust', one_line: '延遲就是錢' }],
  },
  analysis: {
    winner: 'go', margin: 0.05, ranking: ['go', 'rust'], totals: { go: 7.4, rust: 7.35 },
    win_probability: { go: 0.6, rust: 0.4 }, minimax_regret_option: 'rust',
    tipping_points: [{ criterion_id: 'speed', criterion_label: '交付速度', current_weight: 0.7, threshold: 0.65, direction: 'decrease', new_winner: 'rust' }],
    persona_lens: { perf_zealot: { winner: 'rust', totals: { go: 6.5, rust: 8 } } },
    persona_own_view: { perf_zealot: { winner: 'rust', totals: { go: 5, rust: 9 } } },
  },
});

test('report reads extras from input.json (the file SKILL.md passes) and derives confidence from numbers', () => {
  const input = { options: [], chairSamples: [], extras: {
    verdict: { recommended_option_id: 'go', confidence_label: '高', one_liner: '先求活', conditions_to_flip: ['p99 SLA < 5ms'] },
    red_team: '紅隊：GC 停頓會在第 2 年咬人。',
    risks: [{ option_id: 'go', risk: 'GC', likelihood: '低', impact: '中', mitigation: '壓測' }],
    unresolved_disputes: [{ title: '真實 QPS', positions: { perf_zealot: '會到 5k' }, what_would_settle_it: '看 log' }],
  } };
  const md = generateReportMarkdown(baseAnalysis(), { question: 'q', turns: [], claims: {} }, input);
  assert.ok(md.includes('先求活'), 'verdict from input.extras must be rendered');
  assert.ok(md.includes('紅隊：GC 停頓'), 'red team section rendered');
  assert.ok(md.includes('風險登記表') && md.includes('未解決的爭議'));
  assert.ok(md.includes('信心評級：中'), '60% win probability is 中, not the hard-coded 高');
  assert.ok(md.includes('判決自填的信心評級「高」'));
  assert.ok(md.includes('過於接近'), 'margin < 0.1 must be called out');
  assert.ok(md.includes('**65%** 以下'), 'a decrease tipping point reads 以下, not 以上');
  assert.ok(md.includes('延遲就是錢'), 'persona one_line comes from matrix.persona_scores');
  assert.ok(md.includes('最小化最大後悔方案是 `rust`'));
});

test('report accepts the verdict field names models actually produced (winner/confidence/text)', () => {
  const md = generateReportMarkdown(baseAnalysis(), { turns: [], claims: {} }, { verdict: { winner: 'rust', confidence: 'high', text: '選 Rust。' } });
  assert.ok(md.includes('選 Rust。'));
  assert.ok(md.includes('與程式計算贏家 `go` 不一致'));
});

test('report renders object-valued fields as text and narrow tipping windows as a range', () => {
  const a = baseAnalysis();
  a.analysis.tipping_points = [{ criterion_id: 'perf', criterion_label: '性能', current_weight: 0.3, threshold: 0.4, window_end: 0.42, direction: 'increase', new_winner: 'rust' }];
  const md = generateReportMarkdown(a, { turns: [], claims: {} }, {
    verdict: { conditions_to_flip: [a.analysis.tipping_points[0], { text: '尖峰超過 2 萬 RPS' }] },
    red_team: { markdown: '紅隊物件' },
  });
  assert.ok(!md.includes('[object Object]'));
  assert.ok(md.includes('尖峰超過 2 萬 RPS') && md.includes('紅隊物件'));
  assert.ok(md.includes('**40%–42% 之間**'));
});
