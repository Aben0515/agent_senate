#!/usr/bin/env node
// Agent Senate — deterministic matrix analysis.
//
// The LLM judges (scores cells); this script does ALL the arithmetic:
// median aggregation, weighted totals, ranking, tipping points, Monte Carlo
// win probability, persona lenses, minimax regret, disagreement hotspots,
// and renders a self-contained interactive matrix.html.
//
// Usage:  node analyze.mjs <input.json> [--out <dir>]
// Writes: <dir>/analysis.json and <dir>/matrix.html  (dir defaults to input's folder)

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const EPS = 1e-9;
const key = (o, c) => `${o}|${c}`;
const round = (x, d) => {
  const f = 10 ** d;
  return Math.round(x * f) / f;
};
const clampScore = (s) => Math.min(10, Math.max(1, Number(s)));

// ---------------------------------------------------------------- core math

export function normalizeWeights(weights) {
  const ids = Object.keys(weights);
  const total = ids.reduce((a, k) => a + Math.max(0, Number(weights[k]) || 0), 0);
  const out = {};
  for (const k of ids) {
    out[k] = total <= 0 ? 1 / (ids.length || 1) : Math.max(0, Number(weights[k]) || 0) / total;
  }
  return out;
}

export function weightedTotals(options, criteria, weights, scores) {
  const w = normalizeWeights(weights);
  const totals = {};
  for (const o of options) {
    let s = 0;
    for (const c of criteria) s += (w[c.id] ?? 0) * (scores[key(o.id, c.id)] ?? 5);
    totals[o.id] = s;
  }
  return totals;
}

export function rankOptions(totals, winProbability = {}) {
  return Object.keys(totals).sort((a, b) => {
    if (Math.abs(totals[a] - totals[b]) > EPS) return totals[b] - totals[a];
    const pa = winProbability[a] ?? 0;
    const pb = winProbability[b] ?? 0;
    if (Math.abs(pa - pb) > EPS) return pb - pa;
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

function scaledWeights(criteria, normW, k, t) {
  const other = 1 - (normW[k] ?? 0);
  const out = {};
  for (const c of criteria) out[c.id] = c.id === k ? t : (normW[c.id] ?? 0) * (1 - t) / other;
  return out;
}

/** Analytic tipping points. T[o](t) is linear in the weight t of criterion k. */
export function findTippingPoints(options, criteria, weights, scores) {
  const normW = normalizeWeights(weights);
  const ranking = rankOptions(weightedTotals(options, criteria, normW, scores));
  if (!ranking.length) return [];
  const winner = ranking[0];
  const result = [];

  for (const crit of criteria) {
    const k = crit.id;
    const wk = normW[k] ?? 0;
    if (wk >= 0.999) continue;
    const other = 1 - wk;
    if (other <= 1e-9) continue;

    const R = {};
    for (const o of options) {
      let s = 0;
      for (const c of criteria) if (c.id !== k) s += (normW[c.id] ?? 0) * (scores[key(o.id, c.id)] ?? 5);
      R[o.id] = s / other;
    }

    let bestT = null;
    let bestWinner = null;
    let minDist = Infinity;
    for (const opt of options) {
      if (opt.id === winner) continue;
      const sW = scores[key(winner, k)] ?? 5;
      const sO = scores[key(opt.id, k)] ?? 5;
      const denom = (sW - R[winner]) - (sO - R[opt.id]);
      if (Math.abs(denom) < 1e-12) continue;
      const tStar = (R[opt.id] - R[winner]) / denom;
      if (tStar < 0 || tStar > 1) continue;
      const dist = Math.abs(tStar - wk);
      const delta = tStar > wk ? Math.min(0.002, (1 - tStar) / 2) : -Math.min(0.002, tStar / 2);
      const tTest = Math.max(0, Math.min(1, tStar + delta));
      const testTotals = weightedTotals(options, criteria, scaledWeights(criteria, normW, k, tTest), scores);
      const testWinner = rankOptions(testTotals)[0];
      // The new winner must lead strictly; a tie broken by id at t=0 or t=1 is not a real flip.
      const strictFlip = testWinner !== winner && testTotals[testWinner] > testTotals[winner] + EPS;
      if (strictFlip && dist < minDist) {
        minDist = dist;
        bestT = tStar;
        bestWinner = testWinner;
      }
    }
    if (bestT !== null) {
      result.push({
        criterion_id: k,
        criterion_label: crit.label,
        current_weight: round(wk, 3),
        threshold: round(bestT, 3),
        direction: bestT > wk ? 'increase' : 'decrease',
        new_winner: bestWinner,
      });
    }
  }
  return result;
}

/** Brute-force reference (used by the tests to validate the analytic solution). */
export function findTippingPointsBruteForce(options, criteria, weights, scores, step = 0.001) {
  const normW = normalizeWeights(weights);
  const winner = rankOptions(weightedTotals(options, criteria, normW, scores))[0];
  const result = [];
  for (const crit of criteria) {
    const k = crit.id;
    const wk = normW[k] ?? 0;
    if (1 - wk <= 1e-9) continue;
    let flip = null;
    let newWinner = null;
    let minDist = Infinity;
    for (const dir of [1, -1]) {
      // scan in `step` increments and finish on the exact boundary (0 or 1), which a fixed step can skip
      const ts = [];
      for (let t = wk; t >= 0 && t <= 1; t += dir * step) ts.push(t);
      ts.push(dir > 0 ? 1 : 0);
      for (const t of ts) {
        const tt = Math.min(1, Math.max(0, t));
        const tot = weightedTotals(options, criteria, scaledWeights(criteria, normW, k, tt), scores);
        const cur = rankOptions(tot)[0];
        if (cur !== winner && tot[cur] > tot[winner] + EPS) {
          const dist = Math.abs(tt - wk);
          if (dist < minDist) {
            minDist = dist;
            flip = tt;
            newWinner = cur;
          }
          break;
        }
      }
    }
    if (flip !== null) {
      result.push({
        criterion_id: k,
        criterion_label: crit.label,
        current_weight: round(wk, 3),
        threshold: round(flip, 3),
        direction: flip > wk ? 'increase' : 'decrease',
        new_winner: newWinner,
      });
    }
  }
  return result;
}

// ------------------------------------------------------------ Monte Carlo

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeSamplers(rand) {
  const normal = () => {
    let u = 0;
    while (u === 0) u = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
  };
  const gamma = (alpha) => {
    if (alpha < 1) return gamma(alpha + 1) * Math.pow(rand() || 1e-12, 1 / alpha);
    const d = alpha - 1 / 3;
    const c = 1 / Math.sqrt(9 * d);
    for (;;) {
      let x;
      let v;
      do {
        x = normal();
        v = 1 + c * x;
      } while (v <= 0);
      v = v * v * v;
      const u = rand();
      if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
    }
  };
  const dirichlet = (alphas) => {
    const g = alphas.map(gamma);
    const s = g.reduce((a, b) => a + b, 0);
    return g.map((x) => x / s);
  };
  return { normal, dirichlet };
}

export function runMonteCarlo(options, criteria, weights, scores, cellSpread, opts = {}) {
  const samples = opts.samples ?? 5000;
  const conc = opts.concentration ?? 20;
  const seedUsed = opts.seed ? Number(opts.seed) : 1 + Math.floor(Math.random() * 999999);
  const { normal, dirichlet } = makeSamplers(mulberry32(seedUsed));
  const normW = normalizeWeights(weights);
  const alpha = criteria.map((c) => Math.max(0.01, (normW[c.id] ?? 0.01) * conc));
  const wins = Object.fromEntries(options.map((o) => [o.id, 0]));

  for (let i = 0; i < samples; i++) {
    const w = dirichlet(alpha);
    let bestId = null;
    let best = -Infinity;
    for (const o of options) {
      let t = 0;
      criteria.forEach((c, ci) => {
        const mu = scores[key(o.id, c.id)] ?? 5;
        const sd = Math.max(0.3, cellSpread[key(o.id, c.id)] ?? 0.3);
        t += w[ci] * Math.min(10, Math.max(1, mu + sd * normal()));
      });
      if (t > best) {
        best = t;
        bestId = o.id;
      }
    }
    wins[bestId] += 1;
  }
  const probability = {};
  for (const o of options) probability[o.id] = round(wins[o.id] / samples, 4);
  return { probability, seedUsed };
}

// ------------------------------------------------------------ aggregation

const median = (arr) => {
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const stdev = (arr) => {
  if (arr.length < 2) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  return Math.sqrt(arr.reduce((a, b) => a + (b - mean) ** 2, 0) / arr.length);
};

/** Validate one scoring sample: every option x criterion exactly covered. */
function validCells(sample, options, criteria, label, warnings) {
  const map = new Map();
  const optIds = new Set(options.map((o) => o.id));
  const critIds = new Set(criteria.map((c) => c.id));
  for (const cell of sample.cells ?? []) {
    if (!optIds.has(cell.option_id) || !critIds.has(cell.criterion_id)) {
      warnings.push(`${label}: unknown id ${cell.option_id}|${cell.criterion_id} ignored`);
      continue;
    }
    const s = Number(cell.score);
    if (!Number.isFinite(s)) {
      warnings.push(`${label}: non-numeric score for ${cell.option_id}|${cell.criterion_id}`);
      continue;
    }
    if (s < 1 || s > 10) warnings.push(`${label}: score ${s} out of 1-10 clamped (${cell.option_id}|${cell.criterion_id})`);
    map.set(key(cell.option_id, cell.criterion_id), { ...cell, score: clampScore(s) });
  }
  const missing = [];
  for (const o of options) for (const c of criteria) if (!map.has(key(o.id, c.id))) missing.push(key(o.id, c.id));
  if (missing.length) warnings.push(`${label}: missing cells ${missing.join(', ')}`);
  return { map, complete: missing.length === 0 };
}

export function aggregate(input) {
  const { options, criteria } = input;
  const warnings = [];
  const samples = [];
  (input.chairSamples ?? []).forEach((s, i) => {
    const { map, complete } = validCells(s, options, criteria, `chairSamples[${i}]`, warnings);
    if (complete) samples.push({ weights: normalizeWeights(fillWeights(s.weights, criteria)), map, raw: s });
    else warnings.push(`chairSamples[${i}] dropped (incomplete)`);
  });
  if (!samples.length) throw new Error('No complete chair scoring sample. Re-run the judge subagents.');

  const personaScores = [];
  (input.personaScores ?? []).forEach((p, i) => {
    const { map, complete } = validCells(p, options, criteria, `personaScores[${p.speaker_id ?? i}]`, warnings);
    if (complete) personaScores.push({ ...p, weights: normalizeWeights(fillWeights(p.weights, criteria)), map });
    else warnings.push(`personaScores[${p.speaker_id ?? i}] dropped (incomplete)`);
  });

  const weights = {};
  for (const c of criteria) weights[c.id] = samples.reduce((a, s) => a + (s.weights[c.id] ?? 0), 0) / samples.length;
  const normW = normalizeWeights(weights);

  const weightRationale = {};
  for (const c of criteria) {
    for (const s of samples) {
      const r = s.raw.weight_rationale?.[c.id];
      if (r) {
        weightRationale[c.id] = r;
        break;
      }
    }
  }

  const cells = [];
  const scores = {};
  const cellSpread = {};
  for (const o of options) {
    for (const c of criteria) {
      const k = key(o.id, c.id);
      const vals = samples.map((s) => s.map.get(k).score);
      const med = median(vals);
      const nearest = samples.map((s) => s.map.get(k)).sort((a, b) => Math.abs(a.score - med) - Math.abs(b.score - med))[0];
      scores[k] = med;
      const spreadVals = [...vals, ...personaScores.map((p) => p.map.get(k).score)];
      cellSpread[k] = round(stdev(spreadVals), 3);
      cells.push({
        option_id: o.id,
        criterion_id: c.id,
        score: round(med, 2),
        rationale: nearest.rationale ?? '',
        evidence_claim_ids: nearest.evidence_claim_ids ?? [],
        confidence: nearest.confidence ?? 'medium',
      });
    }
  }

  return { weights: normW, weightRationale, cells, scores, cellSpread, personaScores, warnings, sampleCount: samples.length };
}

function fillWeights(w, criteria) {
  const out = {};
  for (const c of criteria) out[c.id] = Math.max(0, Number(w?.[c.id]) || 0);
  return out;
}

// -------------------------------------------------------------- analysis

export function analyze(input) {
  const { options, criteria } = input;
  const agg = aggregate(input);
  const { weights, scores, cellSpread, personaScores } = agg;

  const baseTotals = weightedTotals(options, criteria, weights, scores);
  const mc = runMonteCarlo(options, criteria, weights, scores, cellSpread, {
    samples: input.monteCarloSamples ?? 5000,
    concentration: input.dirichletConcentration ?? 20,
    seed: input.seed ?? 0,
  });
  const totals = Object.fromEntries(Object.entries(baseTotals).map(([k, v]) => [k, round(v, 4)]));
  const ranking = rankOptions(baseTotals, mc.probability);
  const winner = ranking[0];
  const margin = ranking.length > 1 ? round(baseTotals[ranking[0]] - baseTotals[ranking[1]], 4) : 0;

  const lens = (ps) => {
    const t = weightedTotals(options, criteria, ps.weights, scores);
    const r = rankOptions(t);
    return { winner: r[0], totals: roundObj(t), ranking: r };
  };
  const ownView = (ps) => {
    const own = Object.fromEntries([...ps.map].map(([k, v]) => [k, v.score]));
    const t = weightedTotals(options, criteria, ps.weights, own);
    const r = rankOptions(t);
    return { winner: r[0], totals: roundObj(t), ranking: r };
  };
  const personaLens = {};
  const personaOwnView = {};
  for (const ps of personaScores) {
    personaLens[ps.speaker_id] = lens(ps);
    personaOwnView[ps.speaker_id] = ownView(ps);
  }

  // minimax regret over {chair weights} U {persona weights}, all on chair scores
  const lensWeights = [weights, ...personaScores.map((p) => p.weights)];
  const lensTotals = lensWeights.map((lw) => weightedTotals(options, criteria, lw, scores));
  const bestPerLens = lensTotals.map((t) => Math.max(...Object.values(t)));
  const maxRegret = {};
  for (const o of options) {
    maxRegret[o.id] = round(Math.max(...lensTotals.map((t, i) => bestPerLens[i] - t[o.id])), 4);
  }
  const minimaxRegretOption = Object.keys(maxRegret).sort((a, b) => maxRegret[a] - maxRegret[b] || (a < b ? -1 : 1))[0];

  const hotspots = Object.entries(cellSpread)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([k, spread]) => {
      const [optionId, criterionId] = k.split('|');
      const persona_scores = {};
      for (const ps of personaScores) persona_scores[ps.speaker_id] = ps.map.get(k).score;
      return { cell_key: k, option_id: optionId, criterion_id: criterionId, spread, chair_score: scores[k], persona_scores };
    });

  const analysis = {
    totals,
    ranking,
    winner,
    margin,
    tipping_points: findTippingPoints(options, criteria, weights, scores),
    win_probability: mc.probability,
    seed_used: mc.seedUsed,
    persona_lens: personaLens,
    persona_own_view: personaOwnView,
    max_regret: maxRegret,
    minimax_regret_option: minimaxRegretOption,
    disagreement_hotspots: hotspots,
  };

  const matrix = {
    question: input.question ?? '',
    options,
    criteria,
    weights: roundObj(weights, 4),
    weight_rationale: agg.weightRationale,
    cells: agg.cells,
    cell_spread: cellSpread,
    persona_scores: personaScores.map((p) => ({
      speaker_id: p.speaker_id,
      weights: roundObj(p.weights, 4),
      cells: [...p.map.values()],
      final_choice: p.final_choice ?? '',
      one_line: p.one_line ?? '',
    })),
  };
  return { matrix, analysis, warnings: agg.warnings, sample_count: agg.sampleCount };
}

function roundObj(o, d = 4) {
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, round(v, d)]));
}

// ------------------------------------------------------------------ HTML

export function renderHtml(result, extras = {}) {
  const data = JSON.stringify({ ...result, extras }).replace(/</g, '\\u003c').split(String.fromCharCode(0x2028)).join('').split(String.fromCharCode(0x2029)).join('');
  const here = dirname(fileURLToPath(import.meta.url));
  const tpl = readFileSync(join(here, 'matrix.template.html'), 'utf8');
  return tpl.replace('/*__DATA__*/null', () => data);
}

// ------------------------------------------------------------------- CLI

function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--'));
  if (!file) {
    console.error('usage: node analyze.mjs <input.json> [--out <dir>]');
    process.exit(2);
  }
  const outIdx = args.indexOf('--out');
  const outDir = resolve(outIdx >= 0 ? args[outIdx + 1] : dirname(resolve(file)));
  let input;
  try {
    input = JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, ''));
  } catch (e) {
    console.error(`cannot read ${file}: ${e.message}`);
    process.exit(2);
  }
  let result;
  try {
    result = analyze(input);
  } catch (e) {
    console.error(`analysis failed: ${e.message}`);
    process.exit(1);
  }
  mkdirSync(outDir, { recursive: true });
  const analysisPath = join(outDir, 'analysis.json');
  const htmlPath = join(outDir, 'matrix.html');
  writeFileSync(analysisPath, JSON.stringify(result, null, 2), 'utf8');
  writeFileSync(htmlPath, renderHtml(result, input.extras ?? {}), 'utf8');
  const a = result.analysis;
  console.log(
    JSON.stringify(
      {
        winner: a.winner,
        margin: a.margin,
        totals: a.totals,
        win_probability: a.win_probability,
        tipping_points: a.tipping_points,
        minimax_regret_option: a.minimax_regret_option,
        warnings: result.warnings,
        files: { analysis: analysisPath, html: htmlPath },
      },
      null,
      2,
    ),
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
