#!/usr/bin/env node
/**
 * report.mjs — Deterministic report assembly.
 * Combines analysis.json, state.json and the extras (from input.json) into
 * report.md. Every number is copied from analysis.json; nothing is recomputed
 * by hand.
 *
 * Usage: node report.mjs <analysis.json> <state.json> [input.json|extras.json] [--out report.md]
 */

import { writeFileSync, existsSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { computeScoreboard, speakerName } from './ledger.mjs';
import {
  readJson, isMain, runCli, UsageError, confidenceLabel, normalizeVerdict, normalizeHighlight,
  extractExtras, PERSONAS, canonicalSpeaker, toText,
} from './common.mjs';

function cell(text) {
  if (text === null || text === undefined) return '';
  return String(text).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

const fmt = (x, d = 2) => (Number.isFinite(Number(x)) ? Number(x).toFixed(d) : '—');
const pct = (x) => (Number.isFinite(Number(x)) ? `${Math.round(Number(x) * 100)}%` : '—');

/** Is the result a close call? (SKILL.md Phase 9 rule) */
export function closeCallReasons(analysis) {
  const reasons = [];
  const wp = analysis.win_probability ?? {};
  const winner = analysis.winner;
  const best = Object.entries(wp).sort((a, b) => b[1] - a[1])[0];
  if (Number.isFinite(analysis.margin) && analysis.margin < 0.1) reasons.push(`領先幅度僅 ${fmt(analysis.margin)} 分（< 0.1）`);
  if (best && winner && best[0] !== winner && best[1] > (wp[winner] ?? 0)) {
    reasons.push(`加權總分贏家 \`${winner}\` 的模擬勝率（${pct(wp[winner])}）不是最高，最高的是 \`${best[0]}\`（${pct(best[1])}）`);
  }
  return reasons;
}

export function generateReportMarkdown(rawAnalysis, state = {}, rawExtras = {}) {
  // Support both analysis.json ({ matrix, analysis }) and a flat analysis object.
  const analysis = rawAnalysis.analysis || rawAnalysis;
  const matrix = rawAnalysis.matrix || analysis.matrix || {};
  const extras = extractExtras(rawExtras);
  const brief = state.brief || {};
  const options = matrix.options?.length ? matrix.options : brief.options || [];
  // Criteria must follow the locked (Phase 6) set used for scoring, which lives in the matrix.
  const criteria = matrix.criteria?.length ? matrix.criteria : brief.criteria || [];
  const optLabel = Object.fromEntries(options.map((o) => [o.id, o.label || o.id]));
  const critLabel = Object.fromEntries(criteria.map((c) => [c.id, c.label || c.id]));
  const nameOf = (id) => {
    const persona = (extras.personas || []).find((p) => p.id === id);
    if (persona) return `${persona.emoji ?? ''} ${persona.short_name ?? id}`.trim();
    return PERSONAS[canonicalSpeaker(id)] ? speakerName(canonicalSpeaker(id)) : id;
  };

  const verdict = normalizeVerdict(extras.verdict);
  const winner = analysis.winner || '';
  const winProb = analysis.win_probability?.[winner] ?? 0;
  // The confidence band is derived from the numbers, never taken on faith.
  const confidence = confidenceLabel(winProb);
  const closeCall = closeCallReasons(analysis);

  const L = [];
  L.push(`# 虛擬內閣決策裁決報告：${state.question || matrix.question || '技術選型決策辯論'}\n`);

  // 1. Conclusion
  L.push('## 一、一句話結論\n');
  L.push(`> **推薦方案：${optLabel[winner] ?? winner}（\`${winner}\`）**（模擬勝率：${pct(winProb)}，加權總分：${fmt(analysis.totals?.[winner])}，信心評級：${confidence}）`);
  if (verdict.one_liner) L.push(`>\n> ${verdict.one_liner}`);
  L.push('');
  if (verdict.recommended_option_id && verdict.recommended_option_id !== winner) {
    L.push(`> ❌ **判決文字推薦的 \`${verdict.recommended_option_id}\` 與程式計算贏家 \`${winner}\` 不一致，以程式結果為準。**\n`);
  }
  if (verdict.confidence_label && verdict.confidence_label !== confidence) {
    L.push(`> ⚠️ 判決自填的信心評級「${verdict.confidence_label}」與勝率規則不符，已改用「${confidence}」。\n`);
  }
  if (closeCall.length) {
    L.push(`> ⚠️ **結果過於接近**：${closeCall.join('；')}。請先執行下方「下一步驗證實驗」再定案。\n`);
  }
  if (analysis.minimax_regret_option && analysis.minimax_regret_option !== winner) {
    L.push(`> ⚠️ 最小化最大後悔方案是 \`${analysis.minimax_regret_option}\`（${optLabel[analysis.minimax_regret_option] ?? ''}），與贏家不同：若最怕「選錯的代價」，它是更保守的選擇。\n`);
  }
  if (verdict.recommendation_text) L.push(verdict.recommendation_text + '\n');
  if (verdict.main_cost) L.push(`**主要代價**：${verdict.main_cost}\n`);
  if (verdict.conditions_to_flip.length) {
    L.push('**翻盤條件**：');
    for (const c of verdict.conditions_to_flip) L.push(`- ${c}`);
    L.push('');
  }
  L.push('---\n');

  // 2. Framing
  L.push('## 二、問題框定與情境約束\n');
  if (brief.restated_question) L.push(`**決策題目**：${brief.restated_question}\n`);
  if (options.length) {
    L.push('### 候選方案');
    for (const o of options) L.push(`- \`${o.id}\` **${o.label ?? o.id}**${o.description ? ` — ${o.description}` : ''}`);
    L.push('');
  }
  if (brief.context_facts?.length) {
    L.push('### 情境事實（硬性約束）');
    for (const f of brief.context_facts) L.push(`- ${f}`);
    L.push('');
  }
  if (brief.assumptions?.length) {
    L.push('### 採納之前提假設');
    for (const a of brief.assumptions) {
      if (typeof a === 'string') L.push(`- ${a}`);
      else {
        const parts = [a.why_needed && `原因：${a.why_needed}`, a.impact_if_wrong && `若不成立影響：${a.impact_if_wrong}`].filter(Boolean);
        L.push(`- **${a.text ?? ''}**${parts.length ? `（${parts.join('；')}）` : ''}`);
      }
    }
    L.push('');
  }
  L.push('---\n');

  // 3. Matrix
  L.push('## 三、決策權衡矩陣（由程式計算產生）\n');
  L.push(`本矩陣由 ${analysis.diagnostics?.effective_samples ?? '多'} 位中立評審獨立評分，經 \`analyze.mjs\` 取每格中位數並以平均權重加權：\n`);
  L.push(`| 準則 ID | 評估準則（越高越好） | 中立權重 | ${options.map((o) => `${cell(o.label ?? o.id)} (\`${o.id}\`)`).join(' | ')} | 贏家該格理由 |`);
  L.push(`|---|---|:---:|${options.map(() => ':---:').join('|')}|---|`);
  const cellMap = Object.fromEntries((matrix.cells ?? []).map((c) => [`${c.option_id}|${c.criterion_id}`, c]));
  for (const c of criteria) {
    const scores = options.map((o) => {
      const x = cellMap[`${o.id}|${c.id}`];
      return x ? fmt(x.score, 1) : '-';
    });
    const why = cellMap[`${winner}|${c.id}`]?.rationale ?? '';
    L.push(`| \`${c.id}\` | ${cell(c.label)} | **${pct(matrix.weights?.[c.id] ?? 0)}** | ${scores.join(' | ')} | ${cell(why)} |`);
  }
  L.push(`| **加權總分** | — | **100%** | ${options.map((o) => `**${fmt(analysis.totals?.[o.id])}**`).join(' | ')} | **領先幅度：${fmt(analysis.margin)} 分** |`);
  const rationale = matrix.weight_rationale ?? {};
  if (Object.keys(rationale).length) {
    L.push('\n**權重理由**：');
    for (const c of criteria) if (rationale[c.id]) L.push(`- ${critLabel[c.id]}（${pct(matrix.weights?.[c.id] ?? 0)}）：${rationale[c.id]}`);
  }
  L.push('\n---\n');

  // 4. Robustness
  L.push('## 四、穩健度與敏感度分析\n');
  L.push(`- **推薦贏家**：\`${winner}\``);
  L.push(`- **領先幅度 (Margin)**：${fmt(analysis.margin)} 分`);
  L.push(`- **最小後悔方案 (Minimax Regret)**：\`${analysis.minimax_regret_option ?? '—'}\``);
  L.push('- **Monte Carlo 模擬勝率**（評審意見擾動與權重隨機變動下的獲勝比例；這是評分的敏感度指標，不是真實商業成功機率）：');
  for (const o of options) L.push(`  - ${o.label ?? o.id} (\`${o.id}\`): **${pct(analysis.win_probability?.[o.id] ?? 0)}**`);
  const d = analysis.diagnostics ?? {};
  if (d.high_agreement_warning) {
    L.push(`  > ⚠️ **評審打分高度一致**（評審平均分歧標準差僅 ${d.judge_agreement_avg_spread}），模擬勝率可能低估現實世界的不確定性。`);
  }
  if (d.single_judge_warning) L.push('  > ⚠️ **只有 1 份可用的評審樣本**，無法估計評審間的不確定性。');
  if (analysis.seed_used !== undefined) L.push(`- 隨機種子：${analysis.seed_used}`);

  L.push('\n### 翻盤臨界點 (Tipping Points)');
  if (analysis.tipping_points?.length) {
    for (const tp of analysis.tipping_points) {
      const up = tp.direction === 'increase';
      const name = tp.criterion_label ?? critLabel[tp.criterion_id] ?? tp.criterion_id;
      const who = `**${optLabel[tp.new_winner] ?? tp.new_winner}（\`${tp.new_winner}\`）**`;
      if (tp.window_end !== null && tp.window_end !== undefined) {
        const [lo, hi] = up ? [tp.threshold, tp.window_end] : [tp.window_end, tp.threshold];
        L.push(`- 若「**${name}**」權重從目前 ${pct(tp.current_weight)} ${up ? '提高' : '降低'}到 **${pct(lo)}–${pct(hi)} 之間**（其他權重等比例縮放），${who} 會勝出；超出這個區間又會換人領先。`);
      } else {
        L.push(`- 若「**${name}**」權重從目前 ${pct(tp.current_weight)} ${up ? '提高' : '降低'}到 **${pct(tp.threshold)}** ${up ? '以上' : '以下'}（其他權重等比例縮放），${who} 將翻盤勝出。`);
      }
    }
  } else {
    L.push('- 任何單一準則的權重在 0–100% 間變動，都不會改變贏家。');
  }

  const personaRows = new Map((matrix.persona_scores ?? []).map((p) => [p.speaker_id, p]));
  L.push('\n### 各人格價值觀視角（Persona Lens：辯手權重 × 中立評審分數）');
  L.push('> 如果採用該辯手的價值觀（權重），但用中立評審的中位數分數，哪個方案勝出：\n');
  L.push('| 辯手 | 勝出方案 | 各方案得分 |');
  L.push('|---|:---:|---|');
  for (const [sp, lens] of Object.entries(analysis.persona_lens ?? {})) {
    const detail = Object.entries(lens.totals ?? {}).map(([k, v]) => `${k}: ${fmt(v)}`).join('、');
    L.push(`| **${cell(nameOf(sp))}** | \`${lens.winner}\` | ${detail} |`);
  }

  L.push('\n### 辯手主觀立場評分（Persona Own View：辯手權重 × 辯手自己的分數）');
  L.push('> 辯手完全依自身偏好打分的結果，僅供對照，不參與贏家判定：\n');
  L.push('| 辯手 | 主觀推薦 | 自報最終選擇 | 各方案主觀得分 | 一句話總結 |');
  L.push('|---|:---:|:---:|---|---|');
  for (const [sp, own] of Object.entries(analysis.persona_own_view ?? {})) {
    const detail = Object.entries(own.totals ?? {}).map(([k, v]) => `${k}: ${fmt(v)}`).join('、');
    const ps = personaRows.get(sp) ?? {};
    L.push(`| **${cell(nameOf(sp))}** | \`${own.winner}\` | ${ps.final_choice ? `\`${ps.final_choice}\`` : '—'} | ${detail} | ${cell(ps.one_line ?? '')} |`);
  }
  L.push('\n---\n');

  let section = 5;
  const zh = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二', '十三'];
  const heading = (title) => L.push(`## ${zh[section++]}、${title}\n`);

  // Red team
  const redTeam = extras.red_team ?? extras.runner_up_defense;
  if (redTeam) {
    heading('紅隊警示（落敗方案最強反向辯護）');
    L.push(toText(redTeam));
    L.push('\n---\n');
  }

  if (extras.key_tradeoffs?.length) {
    heading('關鍵權衡 (Key Trade-offs)');
    for (const kt of extras.key_tradeoffs) {
      L.push(`### ${kt.title ?? ''}`);
      if (kt.gain) L.push(`- **獲得**：${kt.gain}`);
      if (kt.cost) L.push(`- **代價**：${kt.cost}`);
      if (kt.option_ids?.length) L.push(`- **相關方案**：${kt.option_ids.map((x) => `\`${x}\``).join('、')}`);
      L.push('');
    }
    L.push('---\n');
  }

  if (extras.blind_spots?.length || extras.challenged_assumptions?.length) {
    heading('盲點清單與假設挑戰 (Blind Spots)');
    if (extras.blind_spots?.length) {
      L.push('### 盲點獵人發現的盲點');
      for (const bs of extras.blind_spots) {
        L.push(`- **[${String(bs.severity || 'medium').toUpperCase()}] ${bs.title ?? ''}**：${bs.description ?? ''}${bs.why_it_matters ? `（*為何重要：${bs.why_it_matters}*）` : ''}`);
      }
    }
    if (extras.challenged_assumptions?.length) {
      L.push('\n### 沒有人挑戰、但值得懷疑的假設');
      for (const ca of extras.challenged_assumptions) L.push(`- **假設**：${ca.assumption ?? ''} ➔ **質疑**：${ca.challenge ?? ''}`);
    }
    L.push('\n---\n');
  }

  if (extras.unresolved_disputes?.length) {
    heading('未解決的爭議');
    for (const ud of extras.unresolved_disputes) {
      L.push(`### ${ud.title ?? ''}`);
      for (const [who, pos] of Object.entries(ud.positions ?? {})) L.push(`- **${nameOf(who)}**：${pos}`);
      if (ud.what_would_settle_it) L.push(`- **如何解決**：${ud.what_would_settle_it}`);
      L.push('');
    }
    L.push('---\n');
  }

  if (extras.next_experiments?.length) {
    heading('建議的低成本下一步驗證實驗');
    for (const exp of extras.next_experiments) {
      L.push(`- **${exp.title ?? ''}**${exp.effort ? `（預估工時：${exp.effort}）` : ''}`);
      if (exp.description) L.push(`  - 實驗內容：${exp.description}`);
      if (exp.decides) L.push(`  - 能決定：${exp.decides}`);
    }
    L.push('\n---\n');
  }

  if (extras.risks?.length) {
    heading('風險登記表');
    L.push('| 方案 | 風險 | 可能性 | 衝擊 | 緩解 |');
    L.push('|---|---|:---:|:---:|---|');
    for (const r of extras.risks) {
      L.push(`| ${cell(optLabel[r.option_id] ?? r.option_id)} | ${cell(r.risk)} | ${cell(r.likelihood)} | ${cell(r.impact)} | ${cell(r.mitigation)} |`);
    }
    L.push('\n---\n');
  }

  heading('辯論精華與計分板');
  L.push('### 辯手表現計分板');
  L.push('| 辯手 | 提出論點數 | 攻擊命中 | 主動讓步 | 被標謬誤 | 查核存疑 | MVP得分 |');
  L.push('|---|---:|---:|---:|---:|---:|---:|');
  for (const s of Object.values(computeScoreboard(state))) {
    L.push(`| ${cell(nameOf(s.speaker))} | ${s.claims_count} | ${s.attacks_landed} | ${s.concessions_made} | ${s.fallacies_flagged} | ${s.fact_flags} | **${s.mvp_score}** |`);
  }
  if (extras.highlights?.length) {
    L.push('\n### 辯論高光時刻 (Highlights)');
    for (const raw of extras.highlights) {
      const hl = normalizeHighlight(raw);
      L.push(`- **${hl.title || '高光'}**（${nameOf(hl.speaker_id)}）`);
      L.push(`  > 「${String(hl.quote).replace(/\r?\n/g, ' ')}」`);
      if (hl.why) L.push(`  *點評：${hl.why}*`);
    }
  }
  if (extras.mvp) L.push(`\n🏆 **本場 MVP**：**${nameOf(extras.mvp.speaker_id ?? extras.mvp.speaker)}** — ${extras.mvp.comment ?? ''}`);

  if (extras.audit) {
    L.push('\n---\n');
    heading('報告稽核紀錄');
    L.push(typeof extras.audit === 'string' ? extras.audit : '```json\n' + JSON.stringify(extras.audit, null, 2) + '\n```');
  }
  return L.join('\n') + '\n';
}

// ---------------------------------------------------------------------- CLI

const USAGE = '用法：node report.mjs <analysis.json> <state.json> [input.json|extras.json] [--out <report.md>]';

async function main() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: { out: { type: 'string' } },
    allowPositionals: true,
  });
  const [analysisPath, statePath, extrasPath] = positionals;
  if (!analysisPath || !statePath) throw new UsageError(USAGE);

  const analysis = readJson(analysisPath, 'analysis.json');
  const state = readJson(statePath, 'state.json');
  let extras = {};
  if (extrasPath) {
    if (!existsSync(extrasPath)) throw new Error(`找不到 ${extrasPath}`);
    extras = readJson(extrasPath, 'input.json');
  }
  const md = generateReportMarkdown(analysis, state, extras);
  if (values.out) {
    writeFileSync(values.out, md, 'utf8');
    console.log(`Report generated at ${values.out}`);
  } else {
    console.log(md);
  }
}

if (isMain(import.meta.url)) runCli(main);
