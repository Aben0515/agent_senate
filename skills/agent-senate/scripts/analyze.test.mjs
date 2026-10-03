import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  normalizeWeights, weightedTotals, rankOptions, findTippingPoints,
  findTippingPointsBruteForce, runMonteCarlo, aggregate, analyze, renderHtml,
} from './analyze.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const sample = () => JSON.parse(readFileSync(join(here, '..', 'examples', 'sample-input.json'), 'utf8'));

function lcg(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

test('normalizeWeights sums to 1 and survives all-zero input', () => {
  const n = normalizeWeights({ a: 2, b: 6 });
  assert.equal(n.a + n.b, 1);
  assert.equal(n.b, 0.75);
  const z = normalizeWeights({ a: 0, b: 0 });
  assert.equal(z.a, 0.5);
});

test('rankOptions: totals, then win probability, then id', () => {
  assert.deepEqual(rankOptions({ a: 5, b: 6, c: 4 }), ['b', 'a', 'c']);
  assert.deepEqual(rankOptions({ a: 5, b: 5 }, { a: 0.4, b: 0.6 }), ['b', 'a']);
  assert.deepEqual(rankOptions({ b: 5, a: 5 }), ['a', 'b']);
});

test('analytic tipping points match brute-force scan on 200 random matrices', () => {
  const rand = lcg(12345);
  let compared = 0;
  for (let iter = 0; iter < 200; iter++) {
    const nOpt = 2 + Math.floor(rand() * 3);
    const nCrit = 3 + Math.floor(rand() * 5);
    const options = Array.from({ length: nOpt }, (_, i) => ({ id: `o${i}` }));
    const criteria = Array.from({ length: nCrit }, (_, i) => ({ id: `c${i}`, label: `c${i}` }));
    const weights = Object.fromEntries(criteria.map((c) => [c.id, 0.05 + rand()]));
    const scores = {};
    for (const o of options) for (const c of criteria) scores[`${o.id}|${c.id}`] = 1 + Math.round(rand() * 90) / 10;
    const a = findTippingPoints(options, criteria, weights, scores);
    const b = findTippingPointsBruteForce(options, criteria, weights, scores, 0.001);
    const byId = (arr) => Object.fromEntries(arr.map((t) => [t.criterion_id, t]));
    const A = byId(a);
    const B = byId(b);
    assert.deepEqual(Object.keys(A).sort(), Object.keys(B).sort(), `iteration ${iter}: criteria with a tipping point differ`);
    for (const id of Object.keys(A)) {
      assert.ok(Math.abs(A[id].threshold - B[id].threshold) <= 0.0025, `iter ${iter} ${id}: ${A[id].threshold} vs ${B[id].threshold}`);
      assert.equal(A[id].new_winner, B[id].new_winner, `iter ${iter} ${id}`);
      compared++;
    }
  }
  assert.ok(compared > 50, `expected many comparable tipping points, got ${compared}`);
});

test('tipping point actually flips the winner when applied', () => {
  const { matrix, analysis } = analyze(sample());
  const scores = Object.fromEntries(matrix.cells.map((c) => [`${c.option_id}|${c.criterion_id}`, c.score]));
  assert.ok(analysis.tipping_points.length > 0, 'sample should have tipping points');
  for (const tp of analysis.tipping_points) {
    const k = tp.criterion_id;
    const wk = matrix.weights[k];
    const other = 1 - wk;
    const past = tp.threshold + (tp.direction === 'increase' ? 0.003 : -0.003);
    const w = Object.fromEntries(matrix.criteria.map((c) => [c.id, c.id === k ? past : (matrix.weights[c.id] * (1 - past)) / other]));
    const win = rankOptions(weightedTotals(matrix.options, matrix.criteria, w, scores))[0];
    assert.equal(win, tp.new_winner);
  }
});

test('Monte Carlo is reproducible with a seed and probabilities sum to 1', () => {
  const options = [{ id: 'a' }, { id: 'b' }];
  const criteria = [{ id: 'x' }, { id: 'y' }];
  const scores = { 'a|x': 8, 'a|y': 4, 'b|x': 5, 'b|y': 7 };
  const r1 = runMonteCarlo(options, criteria, { x: 0.5, y: 0.5 }, scores, {}, { samples: 2000, seed: 7 });
  const r2 = runMonteCarlo(options, criteria, { x: 0.5, y: 0.5 }, scores, {}, { samples: 2000, seed: 7 });
  assert.deepEqual(r1, r2);
  assert.ok(Math.abs(r1.probability.a + r1.probability.b - 1) < 1e-3);
  assert.equal(r1.seedUsed, 7);
});

test('Monte Carlo favours a dominant option', () => {
  const options = [{ id: 'a' }, { id: 'b' }];
  const criteria = [{ id: 'x' }, { id: 'y' }];
  const scores = { 'a|x': 9, 'a|y': 9, 'b|x': 3, 'b|y': 3 };
  const r = runMonteCarlo(options, criteria, { x: 1, y: 1 }, scores, {}, { samples: 1000, seed: 3 });
  assert.ok(r.probability.a > 0.99);
});

test('aggregate takes the per-cell median and spread includes persona scores', () => {
  const options = [{ id: 'a' }];
  const criteria = [{ id: 'x' }];
  const mk = (score) => ({ weights: { x: 1 }, cells: [{ option_id: 'a', criterion_id: 'x', score, rationale: `r${score}` }] });
  const agg = aggregate({
    options,
    criteria,
    chairSamples: [mk(2), mk(9), mk(6)],
    personaScores: [{ speaker_id: 'p', weights: { x: 1 }, cells: [{ option_id: 'a', criterion_id: 'x', score: 10 }] }],
  });
  assert.equal(agg.scores['a|x'], 6);
  assert.equal(agg.cells[0].rationale, 'r6');
  assert.ok(agg.cellSpread['a|x'] > 0);
});

test('incomplete samples are dropped with warnings; all-bad input throws', () => {
  const options = [{ id: 'a' }, { id: 'b' }];
  const criteria = [{ id: 'x' }];
  const full = (s) => ({ weights: { x: 1 }, cells: [{ option_id: 'a', criterion_id: 'x', score: s }, { option_id: 'b', criterion_id: 'x', score: s }] });
  const partial = { weights: { x: 1 }, cells: [{ option_id: 'a', criterion_id: 'x', score: 5 }] };
  const agg = aggregate({ options, criteria, chairSamples: [full(4), partial, full(8)] });
  assert.equal(agg.sampleCount, 2);
  assert.ok(agg.warnings.some((w) => w.includes('dropped')));
  assert.throws(() => aggregate({ options, criteria, chairSamples: [partial] }), /No complete chair scoring sample/);
});

test('out-of-range scores are clamped to 1-10', () => {
  const options = [{ id: 'a' }];
  const criteria = [{ id: 'x' }];
  const agg = aggregate({ options, criteria, chairSamples: [{ weights: { x: 1 }, cells: [{ option_id: 'a', criterion_id: 'x', score: 15 }] }] });
  assert.equal(agg.scores['a|x'], 10);
  assert.ok(agg.warnings.some((w) => w.includes('clamped')));
});

test('full analysis on the sample input is coherent', () => {
  const { analysis, matrix } = analyze(sample());
  assert.equal(analysis.winner, analysis.ranking[0]);
  assert.equal(matrix.cells.length, matrix.options.length * matrix.criteria.length);
  const sum = Object.values(analysis.win_probability).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-3);
  assert.ok(analysis.margin >= 0);
  assert.equal(Object.keys(analysis.persona_lens).length, 3);
  assert.ok(analysis.disagreement_hotspots.length > 0);
});

test('renderHtml is XSS-safe and survives dollar patterns in data', () => {
  const result = analyze(sample());
  const evil = { verdict: { one_liner: '</script><img src=x onerror=alert(1)> $& $` costs $5' } };
  const html = renderHtml(result, evil);
  assert.ok(!html.includes('</script><img'), 'closing script tag must be escaped');
  const m = html.match(/<script id="payload" type="application\/json">([\s\S]*?)<\/script>/);
  assert.ok(m, 'payload block present');
  const parsed = JSON.parse(m[1]);
  assert.equal(parsed.extras.verdict.one_liner, evil.verdict.one_liner);
});
