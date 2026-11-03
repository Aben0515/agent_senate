import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const script = (name) => join(here, name);

function run(name, args, cwd = tmpdir()) {
  // Capture through pipes; run from an unrelated cwd to prove scripts do not depend on it.
  const res = spawnSync(process.execPath, [script(name), ...args], { cwd, encoding: 'utf8' });
  return { status: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

test('CLI entrypoints: print usage and exit with code 2 when invoked without arguments', () => {
  const scripts = [
    { name: 'audit.mjs', expected: '用法：node audit.mjs' },
    { name: 'ledger.mjs', expected: '用法：node ledger.mjs' },
    { name: 'report.mjs', expected: '用法：node report.mjs' },
    { name: 'validate.mjs', expected: '用法：node validate.mjs' },
    { name: 'quality.mjs', expected: '用法：node quality.mjs' },
    { name: 'analyze.mjs', expected: 'usage: node analyze.mjs' },
  ];
  for (const s of scripts) {
    const res = run(s.name, []);
    assert.equal(res.status, 2, `${s.name} should exit 2 on missing args, got ${res.status}`);
    assert.ok((res.stderr + res.stdout).toLowerCase().includes(s.expected.toLowerCase()), `${s.name}: ${res.stderr}`);
    assert.ok(!res.stderr.includes('    at '), `${s.name} must not print a stack trace`);
  }
});

test('CLI errors are reported without stack traces (missing file, bad JSON)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'senate-cli-err-'));
  try {
    writeFileSync(join(dir, 'bad.json'), '{ not json');
    for (const [name, args] of [
      ['analyze.mjs', [join(dir, 'missing.json')]],
      ['analyze.mjs', [join(dir, 'bad.json')]],
      ['ledger.mjs', ['index', join(dir, 'missing.json')]],
      ['report.mjs', [join(dir, 'missing.json'), join(dir, 'missing.json')]],
      ['validate.mjs', ['judge', join(dir, 'bad.json'), join(dir, 'bad.json')]],
    ]) {
      const res = run(name, args);
      assert.equal(res.status, 1, `${name} ${args.join(' ')} -> ${res.status} ${res.stderr}`);
      assert.ok(res.stderr.startsWith('錯誤：'), `${name}: ${res.stderr}`);
      assert.ok(!res.stderr.includes('    at '), `${name} printed a stack trace`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('analyze.mjs accepts --out before the input path and refuses a missing --state', () => {
  const dir = mkdtempSync(join(tmpdir(), 'senate-cli-out-'));
  try {
    const input = join(repoRoot, 'skills', 'agent-senate', 'examples', 'sample-input.json');
    const ok = run('analyze.mjs', ['--out', dir, input]);
    assert.equal(ok.status, 0, ok.stderr);
    assert.ok(existsSync(join(dir, 'analysis.json')));
    assert.ok(existsSync(join(dir, 'matrix.html')));
    const bad = run('analyze.mjs', [input, '--out', dir, '--state', join(dir, 'nope.json')]);
    assert.equal(bad.status, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI audit.mjs on baseline returns exit code 1 (fails audit on quote splicing)', () => {
  const res = run('audit.mjs', [join(repoRoot, 'evals', 'baseline-go-vs-rust')]);
  assert.equal(res.status, 1, `audit.mjs on baseline should exit with code 1, got ${res.status}`);
  const out = JSON.parse(res.stdout);
  assert.equal(out.passed, false);
  assert.ok(out.issues.length >= 2, 'Should detect real quote splicing issues');
});

// --------------------------------------------------------------------------
// End-to-end: the exact command sequence documented in SKILL.md, fed with
// outputs in the formats that references/prompts.md asks subagents for.
// --------------------------------------------------------------------------

const brief = {
  restated_question: '3 人新創 B2B SaaS 後端：Go 還是 Rust？',
  options: [
    { id: 'go', label: 'Go', description: '快交付' },
    { id: 'rust', label: 'Rust', description: '極致性能' },
  ],
  context_facts: ['3 名工程師，熟 Python', '一年內 500 家企業客戶'],
  assumptions: [{ text: '尖峰 < 2,000 RPS', why_needed: '決定性能權重', impact_if_wrong: '性能權重上升' }],
  criteria: [
    { id: 'delivery_speed', label: '交付速度', description: '越快越好' },
    { id: 'ops_simplicity', label: '維運簡單度', description: '越簡單越好' },
    { id: 'performance', label: '性能與資源效率', description: '越省越好' },
  ],
};

const claimsBlock = (arr) => '\n\n```claims\n' + JSON.stringify(arr, null, 1) + '\n```\n';
const turnText = {
  cto_open: '我選 Go。3 人團隊兩週就能上線第一版，凌晨三點有人修得動。' + claimsBlock([
    { id: 'cto.1', text: 'Go 兩週可上線', quote: '3 人團隊兩週就能上線第一版', kind: 'estimate', supports: ['go'], attacks: [], concedes: [] },
  ]),
  vex_open: '我選 Rust。p99 延遲比 Go 低一個量級（估），雲端帳單省 30%（估）。' + claimsBlock([
    { id: 'vex.1', text: 'Rust 省 30% 雲端成本', quote: '雲端帳單省 30%（估）', kind: 'estimate', supports: ['rust'], attacks: [], concedes: [] },
  ]),
  vex_r1: '> 【陳CTO #cto.1】3 人團隊兩週就能上線第一版\n兩週上線的是 CRUD，不是 SLA。' + claimsBlock([
    { text: 'SLA 才是企業客戶在乎的', quote: '兩週上線的是 CRUD，不是 SLA', kind: 'value', supports: ['rust'], attacks: ['cto.1'], concedes: [] },
  ]),
  cto_r1: '> 【Vex #vex.1】雲端帳單省 30%（估）\n500 家客戶的帳單一個月不到 2,000 美元，省 30% 不夠付一個 Rust 工程師一週薪水。' + claimsBlock([
    { text: '雲端帳單太小，省 30% 無意義', quote: '省 30% 不夠付一個 Rust 工程師一週薪水', kind: 'estimate', supports: ['go'], attacks: ['vex.1'], concedes: [] },
  ]),
  vex_r2: '> 【陳CTO #cto.2】省 30% 不夠付一個 Rust 工程師一週薪水\n【讓步 #vex.1】在這個規模下帳單確實不是重點。但 GC 停頓在報表匯出時會出現。' + claimsBlock([
    { text: '報表匯出會遇到 GC 停頓', quote: 'GC 停頓在報表匯出時會出現', kind: 'prediction', supports: ['rust'], attacks: [], concedes: ['vex.1'] },
  ]),
  cto_r2: '> 【Vex #vex.3】GC 停頓在報表匯出時會出現\n報表丟背景 job 就好，Go 的 GC 停頓是亞毫秒級。' + claimsBlock([
    { text: 'Go GC 停頓亞毫秒', quote: 'Go 的 GC 停頓是亞毫秒級', kind: 'fact', supports: ['go'], attacks: ['vex.3'], concedes: [] },
  ]),
  cto_close: '結辯：我維持 Go。若尖峰真的超過 2 萬 RPS 且 SLA 要求 p99 < 5ms，我的建議就是錯的。',
  vex_close: '結辯：我仍選 Rust，但承認首年交付是硬約束。若團隊無人有 Rust 生產經驗，Go 是務實解。',
};

const judge = (w, goSpeed, rustPerf) => ({
  weights: { delivery_speed: w[0], ops_simplicity: w[1], performance: w[2] },
  weight_rationale: { delivery_speed: '3 人團隊', ops_simplicity: '無專職 SRE', performance: '流量不大' },
  cells: [
    { option_id: 'go', criterion_id: 'delivery_speed', score: goSpeed, rationale: '熟悉度', evidence_claim_ids: ['cto.1'], confidence: 'medium' },
    { option_id: 'go', criterion_id: 'ops_simplicity', score: 8, rationale: '單一 binary', evidence_claim_ids: ['cto.3'], confidence: 'high' },
    { option_id: 'go', criterion_id: 'performance', score: 7, rationale: '夠用', evidence_claim_ids: [], confidence: 'medium' },
    { option_id: 'rust', criterion_id: 'delivery_speed', score: 4, rationale: '學習曲線', evidence_claim_ids: [], confidence: 'medium' },
    { option_id: 'rust', criterion_id: 'ops_simplicity', score: 6, rationale: '工具鏈較新', evidence_claim_ids: [], confidence: 'low' },
    { option_id: 'rust', criterion_id: 'performance', score: rustPerf, rationale: '無 GC', evidence_claim_ids: ['vex.3'], confidence: 'high' },
  ],
  key_tradeoffs: [{ title: '速度 vs 性能', gain: '早上線', cost: '性能天花板', option_ids: ['go', 'rust'] }],
});

const persona = (id, choice, goScore, rustScore) => ({
  speaker_id: id,
  weights: { delivery_speed: 3, ops_simplicity: 2, performance: 1 },
  cells: ['go', 'rust'].flatMap((o) => brief.criteria.map((c) => ({ option_id: o, criterion_id: c.id, score: o === 'go' ? goScore : rustScore, reason: '立場' }))),
  final_choice: choice,
  one_line: `${id} 的總結`,
});

test('end-to-end pipeline following SKILL.md commands passes validate → analyze → report → audit', () => {
  const dir = mkdtempSync(join(tmpdir(), 'senate-e2e-'));
  const p = (n) => join(dir, n);
  const ok = (res, label) => {
    assert.equal(res.status, 0, `${label} failed (${res.status}): ${res.stderr}\n${res.stdout}`);
    return res;
  };
  try {
    writeFileSync(p('brief.json'), JSON.stringify(brief, null, 2));
    ok(run('ledger.mjs', ['init', p('state.json'), '--question', brief.restated_question, '--brief', p('brief.json')]), 'init');
    // init must refuse to clobber an existing ledger
    assert.equal(run('ledger.mjs', ['init', p('state.json'), '--question', 'x']).status, 1);

    const chair = (kind, round, text) => {
      const f = p(`chair_${kind}_${round ?? 0}.md`);
      writeFileSync(f, text);
      ok(run('ledger.mjs', ['chair', p('state.json'), '--kind', kind, ...(round ? ['--round', String(round)] : []), '--file', f]), `chair ${kind}`);
    };
    const turn = (speaker, kind, round, key) => {
      const f = p(`turn_${key}.md`);
      writeFileSync(f, turnText[key]);
      const res = ok(run('ledger.mjs', ['turn', p('state.json'), '--speaker', speaker, '--kind', kind, ...(round ? ['--round', String(round)] : []), '--file', f]), `turn ${key}`);
      return JSON.parse(res.stdout);
    };

    chair('opening', null, '歡迎來到虛擬內閣。今天的題目是 Go 還是 Rust。');
    assert.deepEqual(turn('conservative_cto', 'opening', null, 'cto_open').new_claims, ['cto.1']);
    assert.deepEqual(turn('perf_zealot', 'opening', null, 'vex_open').new_claims, ['vex.1']);

    writeFileSync(p('facts1.json'), JSON.stringify({ checks: [{ claim_id: 'vex.1', verdict: 'questionable', note: '缺推算', correct_magnitude: null }] }));
    ok(run('ledger.mjs', ['facts', p('state.json'), '--file', p('facts1.json'), '--round', '1']), 'facts');
    chair('directive', 1, '@Vex：500 家客戶的月帳單是多少？省 30% 是多少錢？\n@陳CTO：SLA 違約一次賠多少？');
    turn('perf_zealot', 'rebuttal', 1, 'vex_r1');
    turn('conservative_cto', 'rebuttal', 1, 'cto_r1');
    writeFileSync(p('fallacies1.json'), JSON.stringify([{ claim_id: 'vex.1', type: '沒有推算過程的精確數字', explanation: '30% 從哪來？' }]));
    ok(run('ledger.mjs', ['fallacies', p('state.json'), '--file', p('fallacies1.json')]), 'fallacies');

    chair('directive', 2, '@Vex：GC 停頓在 2,000 RPS 下是幾毫秒？\n@陳CTO：報表匯出 10 萬列要多久？');
    const r2 = turn('perf_zealot', 'rebuttal', 2, 'vex_r2');
    assert.deepEqual(r2.concessions, ['vex.1']);
    turn('conservative_cto', 'rebuttal', 2, 'cto_r2');
    turn('perf_zealot', 'closing', null, 'vex_close');
    turn('conservative_cto', 'closing', null, 'cto_close');

    // Phase 7: validate every scoring output; --write-clean produces the JSON for input.json.
    const judges = [judge([5, 3, 1], 9, 9), judge([4, 3, 2], 8, 10), judge([5, 2, 2], 9, 8)];
    const clean = [];
    judges.forEach((j, i) => {
      writeFileSync(p(`judge${i}.txt`), '以下是評分：\n```json\n' + JSON.stringify(j) + '\n```');
      ok(run('validate.mjs', ['judge', p('brief.json'), p(`judge${i}.txt`), '--ledger', p('state.json'), '--write-clean', p(`judge${i}.json`)]), `validate judge ${i}`);
      clean.push(JSON.parse(readFileSync(p(`judge${i}.json`), 'utf8')));
    });
    // A judge citing the conceded claim vex.1 must be rejected.
    const bad = judge([1, 1, 1], 9, 9);
    bad.cells[5].evidence_claim_ids = ['vex.1'];
    writeFileSync(p('judge_bad.json'), JSON.stringify(bad));
    assert.equal(run('validate.mjs', ['judge', p('brief.json'), p('judge_bad.json'), '--ledger', p('state.json')]).status, 1);

    const personas = [persona('conservative_cto', 'go', 8, 4), persona('perf_zealot', 'rust', 5, 9)];
    personas.forEach((ps, i) => {
      writeFileSync(p(`persona${i}.json`), JSON.stringify(ps));
      ok(run('validate.mjs', ['persona', p('brief.json'), p(`persona${i}.json`), '--speaker', ps.speaker_id]), `validate persona ${i}`);
    });

    const input = {
      question: brief.restated_question,
      options: brief.options,
      criteria: brief.criteria,
      chairSamples: clean,
      personaScores: personas,
      seed: 0,
      extras: {},
    };
    writeFileSync(p('input.json'), JSON.stringify(input, null, 2));
    const first = JSON.parse(ok(run('analyze.mjs', [p('input.json'), '--out', dir]), 'analyze 1').stdout);
    assert.equal(first.winner, 'go');
    const analysis = JSON.parse(readFileSync(p('analysis.json'), 'utf8'));

    // Phase 9: verdict + extras, re-run with --state.
    const prob = analysis.analysis.win_probability.go;
    input.extras = {
      verdict: {
        recommended_option_id: 'go',
        confidence_label: prob >= 0.75 ? '高' : prob >= 0.5 ? '中' : '低',
        one_liner: '首年交付是硬約束，選 Go。',
        recommendation_text: '推薦 Go。',
        conditions_to_flip: ['尖峰超過 2 萬 RPS'],
      },
      red_team: '若第二年出現即時報表需求，GC 與記憶體會成為成本。',
      key_tradeoffs: clean[0].key_tradeoffs,
      highlights: [{ title: '帳單算帳', speaker_id: 'conservative_cto', quote: '省 30% 不夠付一個 Rust 工程師一週薪水', why: '把性能換算成錢' }],
      mvp: { speaker_id: 'conservative_cto', comment: '每個論點都換算成錢' },
    };
    writeFileSync(p('input.json'), JSON.stringify(input, null, 2));
    ok(run('analyze.mjs', [p('input.json'), '--out', dir, '--state', p('state.json')]), 'analyze 2');
    const html = readFileSync(p('matrix.html'), 'utf8');
    assert.ok(html.includes('turn_conservative_cto_closing'), 'matrix.html embeds the replay turns');

    ok(run('ledger.mjs', ['transcript', p('state.json'), '--out', p('transcript.md')]), 'transcript');
    ok(run('report.mjs', [p('analysis.json'), p('state.json'), p('input.json'), '--out', p('report.md')]), 'report');
    const report = readFileSync(p('report.md'), 'utf8');
    assert.ok(report.includes('首年交付是硬約束'), 'verdict from input.json extras reaches the report');
    assert.ok(report.includes('紅隊警示'));

    const audit = JSON.parse(run('audit.mjs', [dir]).stdout);
    assert.equal(audit.passed, true, JSON.stringify(audit.issues, null, 2));
    assert.deepEqual(audit.issues.filter((i) => i.severity !== 'low'), [], JSON.stringify(audit.issues, null, 2));

    const quality = JSON.parse(run('quality.mjs', [p('state.json')]).stdout);
    assert.equal(quality.breakdown.closing_integrity, 2);
    assert.equal(quality.breakdown.quote_compliance, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
