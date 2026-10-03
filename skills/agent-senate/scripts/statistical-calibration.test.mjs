import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from './analyze.mjs';

test('statistical calibration: bootstrap with divergent judges yields non-extreme probabilities', () => {
  const options = [{ id: 'opt_a', label: 'Option A' }, { id: 'opt_b', label: 'Option B' }];
  const criteria = [{ id: 'c1', label: 'Crit 1' }, { id: 'c2', label: 'Crit 2' }];

  // 3 divergent judges:
  // Judge 1 prefers A (9 vs 5 on c1, 8 vs 6 on c2)
  // Judge 2 prefers B (5 vs 9 on c1, 6 vs 8 on c2)
  // Judge 3 is neutral (7 vs 7 on both)
  const chairSamples = [
    {
      weights: { c1: 0.5, c2: 0.5 },
      cells: [
        { option_id: 'opt_a', criterion_id: 'c1', score: 9 },
        { option_id: 'opt_a', criterion_id: 'c2', score: 8 },
        { option_id: 'opt_b', criterion_id: 'c1', score: 5 },
        { option_id: 'opt_b', criterion_id: 'c2', score: 6 },
      ],
    },
    {
      weights: { c1: 0.5, c2: 0.5 },
      cells: [
        { option_id: 'opt_a', criterion_id: 'c1', score: 5 },
        { option_id: 'opt_a', criterion_id: 'c2', score: 6 },
        { option_id: 'opt_b', criterion_id: 'c1', score: 9 },
        { option_id: 'opt_b', criterion_id: 'c2', score: 8 },
      ],
    },
    {
      weights: { c1: 0.5, c2: 0.5 },
      cells: [
        { option_id: 'opt_a', criterion_id: 'c1', score: 7 },
        { option_id: 'opt_a', criterion_id: 'c2', score: 7 },
        { option_id: 'opt_b', criterion_id: 'c1', score: 7 },
        { option_id: 'opt_b', criterion_id: 'c2', score: 7 },
      ],
    },
  ];

  const res = analyze({
    options,
    criteria,
    chairSamples,
    personaScores: [],
    seed: 42,
  });

  // Divergent judges should NOT have 100% or 0% probability!
  assert.ok(res.analysis.win_probability.opt_a > 0.1 && res.analysis.win_probability.opt_a < 0.9);
  assert.ok(res.analysis.win_probability.opt_b > 0.1 && res.analysis.win_probability.opt_b < 0.9);

  // Diagnostics check
  assert.ok(res.analysis.diagnostics);
  assert.equal(res.analysis.diagnostics.effective_samples, 3);
  assert.equal(res.analysis.diagnostics.spread_floor_used, 0.5);
  // Spread was high, so high_agreement_warning should be false
  assert.equal(res.analysis.diagnostics.high_agreement_warning, false);
});
