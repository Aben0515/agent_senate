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
  assert.ok(report.includes('推薦方案：Go 語言（go）'));
  assert.ok(report.includes('勝率：100%'));
  assert.ok(report.includes('加權總分：8.82'));
  assert.ok(report.includes('領先幅度：4.48 分'));
  assert.ok(report.includes('| `delivery` | 交付與迭代速度 | **60%** | 9.0 | 4.0 |'));
  assert.ok(report.includes('各人格價值觀視角 (Persona Lens: 辯手權重 × 主席客觀分數)'));
  assert.ok(report.includes('辯手主觀立場評分 (Persona Own View: 辯手自身主觀打分)'));
  assert.ok(report.includes('資源效率與硬體成本'));
  assert.ok(report.includes('**62%** 以上'));
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
  assert.ok(report.includes('推薦方案：Go | Special（go）'));
  assert.ok(report.includes('Go \\| Special'));
  assert.ok(!report.includes('undefined'));
});
