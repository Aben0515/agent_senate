#!/usr/bin/env node
/**
 * report.mjs — Deterministic report assembly:
 * Combines analysis.json, state.json, and extras into a complete,
 * hallucination-free report.md with precise numbers and tables.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { computeScoreboard } from './ledger.mjs';

function escapeMarkdownCell(text) {
  if (text === null || text === undefined) return '';
  return String(text).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

export function generateReportMarkdown(rawAnalysis, state, extras = {}) {
  // Support both top-level analysis.json { matrix, analysis } and flat analysis object
  const analysis = rawAnalysis.analysis || rawAnalysis;
  const matrix = rawAnalysis.matrix || rawAnalysis.analysis?.matrix || analysis.matrix || {};

  const lines = [];
  const q = state.question || '技術選型決策辯論';
  const brief = state.brief || {};
  const options = brief.options || matrix.options || [];
  const criteria = brief.criteria || matrix.criteria || [];

  lines.push(`# 虛擬內閣決策裁決報告：${q}\n`);

  // 1. 一句話結論
  const verdict = extras.verdict || {};
  const recommendedId = (analysis.winner || verdict.recommended_option_id || '').toLowerCase();
  const recommendedOpt = options.find((o) => o.id === recommendedId);
  const recLabel = recommendedOpt ? recommendedOpt.label : recommendedId.toUpperCase();
  const winPct = Math.round((analysis.win_probability?.[recommendedId] || 0) * 100);
  const winnerTotal = analysis.totals?.[recommendedId]?.toFixed(2) || '0.00';

  lines.push('## 一、 一句話結論');
  lines.push(`> **推薦方案：${recLabel}（${recommendedId}）**（勝率：${winPct}%，加權總分：${winnerTotal}，信心評級：${verdict.confidence_label || '高'}）`);
  if (verdict.one_liner) {
    lines.push(`> ${verdict.one_liner}\n`);
  }
  if (verdict.recommendation_text) {
    lines.push(verdict.recommendation_text + '\n');
  }

  lines.push('---\n');

  // 2. 問題框定與情境約束
  lines.push('## 二、 問題框定與情境約束\n');
  if (brief.context_facts && brief.context_facts.length) {
    lines.push('### 情境事實（硬性約束）');
    for (const f of brief.context_facts) {
      lines.push(`- ${f}`);
    }
    lines.push('');
  }
  if (brief.assumptions && brief.assumptions.length) {
    lines.push('### 採納之前提假設');
    for (const a of brief.assumptions) {
      lines.push(`- **${a.text}**（原因：${a.why_needed}；若不成立影響：${a.impact_if_wrong}）`);
    }
    lines.push('');
  }

  lines.push('---\n');

  // 3. 決策權衡矩陣
  lines.push('## 三、 決策權衡矩陣（由程式計算產生）\n');
  lines.push('本矩陣由中立評審獨立評分經 `analyze.mjs` 取中位數並結合情境權重計算：\n');

  const optHeaders = options.map((o) => `${escapeMarkdownCell(o.label)} (\`${o.id}\`)`);
  lines.push(`| 準則 ID | 評估準則（越高越好） | 中立權重 | ${optHeaders.join(' | ')} | 關鍵理由摘要 |`);
  lines.push(`|---|---|:---:|${options.map(() => ':---:').join('|')}|---|`);

  const cellMap = {};
  if (matrix && matrix.cells) {
    for (const c of matrix.cells) {
      cellMap[`${c.option_id}|${c.criterion_id}`] = c;
    }
  }

  for (const crit of criteria) {
    const cid = crit.id;
    const w = matrix.weights?.[cid] || 0.0;
    const wPct = `${Math.round(w * 100)}%`;

    const rowScores = options.map((o) => {
      const cell = cellMap[`${o.id}|${cid}`];
      return cell ? cell.score.toFixed(1) : '-';
    });

    // Pick rationale from winning option or first cell
    const cellWinner = cellMap[`${recommendedId}|${cid}`] || cellMap[`${options[0]?.id}|${cid}`];
    const rationale = cellWinner ? escapeMarkdownCell(cellWinner.rationale) : '';

    lines.push(`| \`${cid}\` | ${escapeMarkdownCell(crit.label)} | **${wPct}** | ${rowScores.join(' | ')} | ${rationale} |`);
  }

  // Total row
  const totalScores = options.map((o) => `**${analysis.totals?.[o.id]?.toFixed(2) || '0.00'}**`);
  lines.push(`| **加權總分** | — | **100%** | ${totalScores.join(' | ')} | **領先幅度：${analysis.margin?.toFixed(2) || '0.00'} 分** |`);
  lines.push('\n---\n');

  // 4. 穩健度與敏感度分析
  lines.push('## 四、 穩健度與敏感度分析\n');
  lines.push(`- **推薦贏家**：\`${analysis.winner}\``);
  lines.push(`- **領先幅度 (Margin)**：${analysis.margin?.toFixed(2)} 分`);
  lines.push(`- **最小後悔方案 (Minimax Regret)**：\`${analysis.minimax_regret_option}\``);
  lines.push('- **Monte Carlo 模擬勝率**：');
  for (const o of options) {
    const p = Math.round((analysis.win_probability?.[o.id] || 0) * 100);
    lines.push(`  - ${o.label} (\`${o.id}\`): **${p}%**`);
  }

  lines.push('\n### 翻盤臨界點 (Tipping Points)');
  if (analysis.tipping_points && analysis.tipping_points.length) {
    for (const tp of analysis.tipping_points) {
      const dirZh = tp.direction === 'increase' ? '提高' : '降低';
      const curPct = Math.round(tp.current_weight * 100);
      const tarPct = Math.round(tp.threshold * 100);
      lines.push(`- 若「**${tp.criterion_label}**」權重從目前 ${curPct}% ${dirZh}至 **${tarPct}%** 以上，**${tp.new_winner}** 將翻盤勝出。`);
    }
  } else {
    lines.push('- 目前在各準則合理變動區間內無單一翻盤點，裁決結論具備高度穩健性。');
  }

  // Persona View 1: persona_lens (辯手權重 x 主席客觀分數)
  lines.push('\n### 各人格價值觀視角 (Persona Lens: 辯手權重 × 主席客觀分數)');
  lines.push('> 說明：檢驗「如果採用該辯手的核心價值觀與權重排序，但依據客觀中位數評分」，哪一個方案會勝出：\n');
  lines.push('| 辯手身分 | 勝出方案 | 各方案得分詳情 |');
  lines.push('|---|:---:|---|');
  if (analysis.persona_lens) {
    for (const [sp, lens] of Object.entries(analysis.persona_lens)) {
      const totalsDetail = Object.entries(lens.totals || {})
        .map(([k, v]) => `${k}: ${v.toFixed(2)}`)
        .join('、');
      lines.push(`| **${sp}** | \`${lens.winner}\` | ${totalsDetail} |`);
    }
  }

  // Persona View 2: persona_own_view (辯手自己打的分數)
  lines.push('\n### 辯手主觀立場評分 (Persona Own View: 辯手自身主觀打分)');
  lines.push('> 說明：辯手完全基於自身偏好與立場各自打出的主觀評分總結：\n');
  lines.push('| 辯手身分 | 主觀推薦 | 各方案主觀得分 | 總結一句話 |');
  lines.push('|---|:---:|---|---|');
  if (analysis.persona_own_view) {
    for (const [sp, own] of Object.entries(analysis.persona_own_view)) {
      const totalsDetail = Object.entries(own.totals || {})
        .map(([k, v]) => `${k}: ${v.toFixed(2)}`)
        .join('、');
      const ps = state.brief?.personaScores?.find((p) => p.speaker_id === sp) || {};
      lines.push(`| **${sp}** | \`${own.winner}\` | ${totalsDetail} | ${escapeMarkdownCell(ps.one_line || '')} |`);
    }
  }

  lines.push('\n---\n');

  // 5. 關鍵權衡
  if (extras.key_tradeoffs && extras.key_tradeoffs.length) {
    lines.push('## 五、 關鍵權衡 (Key Trade-offs)\n');
    for (const kt of extras.key_tradeoffs) {
      lines.push(`### ${kt.title}`);
      lines.push(`- **獲得**：${kt.gain}`);
      lines.push(`- **代價**：${kt.cost}\n`);
    }
    lines.push('---\n');
  }

  // 6. 盲點清單與未挑戰假設
  if (extras.blind_spots && extras.blind_spots.length) {
    lines.push('## 六、 盲點清單與假設挑戰 (Blind Spots)\n');
    lines.push('### 外部架構師排查發現之盲點');
    for (const bs of extras.blind_spots) {
      lines.push(`- **[${(bs.severity || 'medium').toUpperCase()}] ${bs.title}**：${bs.description}（*影響原因：${bs.why_it_matters}*）`);
    }
    if (extras.challenged_assumptions && extras.challenged_assumptions.length) {
      lines.push('\n### 值得警惕之未挑戰假設');
      for (const ca of extras.challenged_assumptions) {
        lines.push(`- **假設**：${ca.assumption} ➔ **挑戰質疑**：${ca.challenge}`);
      }
    }
    lines.push('\n---\n');
  }

  // 7. 下一步驗證實驗
  if (extras.next_experiments && extras.next_experiments.length) {
    lines.push('## 七、 建議之低成本下一步驗證實驗\n');
    for (const exp of extras.next_experiments) {
      lines.push(`- **${exp.title}**（預估工時：${exp.effort}）`);
      lines.push(`  - 實驗內容：${exp.description}`);
      lines.push(`  - 決定事項：${exp.decides}`);
    }
    lines.push('\n---\n');
  }

  // 8. 辯論精華、高光時刻與計分板
  lines.push('## 八、 辯論精華與計分板\n');
  lines.push('### 辯手表現計分板');
  lines.push('| 辯手 | 提出論點數 | 攻擊命中 | 主動讓步 | 被標謬誤 | 查核存疑 | MVP得分 |');
  lines.push('|---|---:|---:|---:|---:|---:|---:|');
  const board = computeScoreboard(state);
  for (const sp of Object.keys(board)) {
    const s = board[sp];
    lines.push(`| ${s.speaker} | ${s.claims_count} | ${s.attacks_landed} | ${s.concessions_made} | ${s.fallacies_flagged} | ${s.fact_flags} | **${s.mvp_score}** |`);
  }

  if (extras.highlights && extras.highlights.length) {
    lines.push('\n### 辯論高光時刻 (Highlights)');
    for (const hl of extras.highlights) {
      lines.push(`- **${hl.title}**（${hl.speaker_id}）\n  > 「${hl.quote}」\n  *點評：${hl.why}*`);
    }
  }

  if (extras.mvp) {
    lines.push(`\n🏆 **本場 MVP**：**${extras.mvp.speaker_id}** — ${extras.mvp.comment}`);
  }

  // 9. 稽核紀錄
  if (extras.audit) {
    lines.push('\n---\n\n## 九、 報告稽核紀錄\n');
    lines.push(typeof extras.audit === 'string' ? extras.audit : JSON.stringify(extras.audit, null, 2));
  }

  return lines.join('\n');
}

// CLI Execution
if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`) {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      out: { type: 'string' },
    },
    allowPositionals: true,
  });

  const analysisPath = positionals[0];
  const statePath = positionals[1];
  const extrasPath = positionals[2];

  if (!analysisPath || !statePath) {
    console.error('用法：node report.mjs <analysis.json> <state.json> [extras.json] [--out <report.md>]');
    process.exit(2);
  }

  const analysis = JSON.parse(readFileSync(analysisPath, 'utf-8'));
  const state = JSON.parse(readFileSync(statePath, 'utf-8'));
  let extras = {};
  if (extrasPath && existsSync(extrasPath)) {
    extras = JSON.parse(readFileSync(extrasPath, 'utf-8'));
  }

  const md = generateReportMarkdown(analysis, state, extras);

  if (values.out) {
    writeFileSync(values.out, md, 'utf-8');
    console.log(`Report generated at ${values.out}`);
  } else {
    console.log(md);
  }
}
