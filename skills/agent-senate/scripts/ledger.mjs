#!/usr/bin/env node
/**
 * ledger.mjs — Deterministic debate ledger:
 * Tracks speech turns, chair directives, claim graph, state transitions,
 * scoreboard, and deterministic transcript formatting.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { extractJsonFromText } from './validate.mjs';

export const SPEAKER_PREFIXES = {
  conservative_cto: 'cto',
  cto: 'cto',
  perf_zealot: 'vex',
  vex: 'vex',
  kiss_hacker: 'kiss',
  kiss: 'kiss',
  security_paranoid: 'sec',
  sec: 'sec',
  product_pm: 'pm',
  pm: 'pm',
};

export function getSpeakerPrefix(speakerId) {
  return SPEAKER_PREFIXES[speakerId.toLowerCase()] || speakerId.toLowerCase().slice(0, 4);
}

export function createInitialState(question, brief = null) {
  return {
    version: 1,
    question,
    brief: brief || null,
    created_at: new Date().toISOString(),
    turns: [],
    chair_events: [],
    claims: {},
    speaker_counters: {},
    fallacies: [],
    fact_checks: [],
  };
}

export function loadState(statePath) {
  if (!existsSync(statePath)) {
    throw new Error(`State file not found at ${statePath}`);
  }
  return JSON.parse(readFileSync(statePath, 'utf-8'));
}

export function saveState(statePath, state) {
  writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf-8');
}

export function addChairTurn(state, { kind, round = null, text }) {
  const turn = {
    id: `chair_${kind}_${round !== null ? round : state.chair_events.length + 1}`,
    type: 'chair',
    kind,
    round,
    text: text.trim(),
    timestamp: new Date().toISOString(),
  };
  state.chair_events.push(turn);
  state.turns.push(turn);
  return turn;
}

export function addDebaterTurn(state, { speaker, kind, round = null, text }) {
  const prefix = getSpeakerPrefix(speaker);
  if (!state.speaker_counters[prefix]) {
    state.speaker_counters[prefix] = 0;
  }

  // Parse claims block
  const claimsBlockRegex = /```claims\s*([\s\S]*?)\s*```/i;
  const match = claimsBlockRegex.exec(text);
  let rawClaims = [];

  if (match) {
    try {
      const parsed = extractJsonFromText(match[1]);
      rawClaims = Array.isArray(parsed) ? parsed : (parsed.claims || []);
    } catch (e) {
      throw new Error(`發言中的 \`\`\`claims 區塊 JSON 解析失敗: ${e.message}`);
    }
  }

  // Regex for in-text concessions: 【讓步 #c1】 or 【讓步 cto.1】
  const concessionRegex = /【讓步\s*#?([a-zA-Z0-9_.-]+)】/g;
  const textConcessions = [];
  let cMatch;
  while ((cMatch = concessionRegex.exec(text)) !== null) {
    textConcessions.push(cMatch[1].trim());
  }

  // Regex for in-text attacks/quotes: 【對手 #cto.1】
  const quoteRefRegex = />?\s*【(?:.+?)\s*#?([a-zA-Z0-9_.-]+)】/g;
  const inTextRefs = [];
  let qMatch;
  while ((qMatch = quoteRefRegex.exec(text)) !== null) {
    inTextRefs.push(qMatch[1].trim());
  }

  const validKinds = new Set(['fact', 'estimate', 'value', 'prediction', 'proposal']);
  const registeredClaims = [];

  for (const raw of rawClaims) {
    if (!raw.text || !raw.quote) {
      throw new Error(`論點缺少 text 或 quote：${JSON.stringify(raw)}`);
    }
    const claimKind = raw.kind ? raw.kind.toLowerCase() : 'value';
    if (!validKinds.has(claimKind)) {
      throw new Error(`無效的 claim kind: \`${raw.kind}\`。只能是：${[...validKinds].join(', ')}`);
    }

    state.speaker_counters[prefix]++;
    const claimId = `${prefix}.${state.speaker_counters[prefix]}`;

    // Combine explicit concessions and in-text concessions
    const allConcessions = Array.from(new Set([...(raw.concedes_claim_ids || []), ...textConcessions]));
    const allAttacks = Array.from(new Set([...(raw.attacks_claim_ids || []), ...inTextRefs]));

    // Validate reference IDs
    for (const ref of allAttacks) {
      if (ref !== claimId && !state.claims[ref]) {
        // Warn instead of hard crash on quote ref, but record
      }
    }
    for (const ref of allConcessions) {
      if (state.claims[ref]) {
        state.claims[ref].status = 'conceded';
      }
    }

    const claimObj = {
      id: claimId,
      speaker,
      turn_kind: kind,
      round,
      text: raw.text.trim(),
      quote: raw.quote.trim(),
      kind: claimKind,
      supports_option_ids: raw.supports_option_ids || [],
      attacks_claim_ids: allAttacks.filter((a) => state.claims[a] && a !== claimId),
      concedes_claim_ids: allConcessions.filter((c) => state.claims[c]),
      status: 'open',
      attacked_by: [],
      fact_check: null,
    };

    // Update target claim's attacked_by & status
    for (const targetId of claimObj.attacks_claim_ids) {
      const target = state.claims[targetId];
      if (target) {
        if (!target.attacked_by.includes(claimId)) {
          target.attacked_by.push(claimId);
        }
        if (target.status !== 'conceded') {
          target.status = 'attacked';
        }
      }
    }

    state.claims[claimId] = claimObj;
    registeredClaims.push(claimObj);
  }

  // Body text without claims block
  const cleanBody = text.replace(claimsBlockRegex, '').trim();

  const turn = {
    id: `turn_${speaker}_${kind}_${round !== null ? round : state.turns.length + 1}`,
    type: 'debater',
    speaker,
    kind,
    round,
    text: cleanBody,
    full_text: text,
    claims: registeredClaims.map((c) => c.id),
    concessions: textConcessions,
    timestamp: new Date().toISOString(),
  };

  state.turns.push(turn);
  return { turn, new_claims: registeredClaims };
}

export function recordFactChecks(state, checks) {
  for (const fc of checks) {
    const claim = state.claims[fc.claim_id];
    if (claim) {
      claim.fact_check = fc;
      if (fc.verdict === 'likely_false') {
        claim.status = 'disputed_fact';
      } else if (fc.verdict === 'plausible' && claim.status === 'open') {
        claim.status = 'plausible';
      }
    }
    state.fact_checks.push(fc);
  }
}

export function recordFallacies(state, fallacies) {
  for (const fa of fallacies) {
    state.fallacies.push(fa);
  }
}

export function renderClaimsIndex(state) {
  const cids = Object.keys(state.claims);
  if (!cids.length) {
    return '（目前尚無論點記錄）';
  }

  const statusIcons = {
    open: '⏳開放',
    attacked: '⚔️被攻擊',
    conceded: '💔已讓步',
    disputed_fact: '❌可能錯誤',
    plausible: '✅合理',
  };

  const lines = [];
  for (const cid of cids) {
    const c = state.claims[cid];
    const badge = statusIcons[c.status] || c.status;
    const fcBadge = c.fact_check && c.fact_check.verdict === 'questionable' ? ' [⚠️存疑]' : '';
    const attacks = c.attacked_by.length ? ` (⚔️來自: ${c.attacked_by.join(', ')})` : '';
    lines.push(`- #${cid} (${c.kind}, ${c.speaker}) [${badge}]${fcBadge}${attacks} ${c.text} ／ 原文：「${c.quote}」`);
  }
  return lines.join('\n');
}

export function computeScoreboard(state) {
  const board = {};
  const speakers = new Set(state.turns.filter((t) => t.type === 'debater').map((t) => t.speaker));

  for (const sp of speakers) {
    board[sp] = {
      speaker: sp,
      claims_count: 0,
      attacks_landed: 0,
      concessions_made: 0,
      fallacies_flagged: 0,
      fact_flags: 0,
      mvp_score: 0,
    };
  }

  // Count claims & status
  for (const c of Object.values(state.claims)) {
    const sp = c.speaker;
    if (!board[sp]) continue;
    board[sp].claims_count++;

    if (c.status === 'conceded') {
      board[sp].concessions_made++;
    }
    if (c.fact_check && ['questionable', 'likely_false'].includes(c.fact_check.verdict)) {
      board[sp].fact_flags++;
    }

    // Attacks landed: attacks directed at a target that later became conceded or disputed_fact
    for (const targetId of c.attacks_claim_ids) {
      const target = state.claims[targetId];
      if (target && ['conceded', 'disputed_fact'].includes(target.status)) {
        board[sp].attacks_landed++;
      }
    }
  }

  for (const fa of state.fallacies) {
    if (board[fa.speaker_id]) {
      board[fa.speaker_id].fallacies_flagged++;
    }
  }

  for (const sp of Object.keys(board)) {
    const s = board[sp];
    s.mvp_score =
      s.attacks_landed * 3 +
      s.concessions_made * 1 -
      s.fallacies_flagged * 2 -
      s.fact_flags * 2;
  }

  return board;
}

export function generateTranscriptMarkdown(state) {
  const lines = [];
  lines.push(`# 完整辯論逐字稿：${state.question}\n`);
  lines.push(`> 建立時間：${state.created_at}\n`);

  if (state.brief) {
    lines.push('## 決策簡報與情境約束\n');
    lines.push(`- **問題**：${state.brief.restated_question || state.question}`);
    if (state.brief.options) {
      lines.push('- **候選方案**：' + state.brief.options.map((o) => `\`${o.id}\` (${o.label})`).join('、'));
    }
    if (state.brief.context_facts && state.brief.context_facts.length) {
      lines.push('- **情境事實**：\n  ' + state.brief.context_facts.map((f) => `- ${f}`).join('\n  '));
    }
    lines.push('\n---\n');
  }

  lines.push('## 辯論完整進程\n');

  for (const turn of state.turns) {
    if (turn.type === 'chair') {
      const roundTag = turn.round !== null ? ` (第 ${turn.round} 輪)` : '';
      lines.push(`### ⚖️ 天秤主席 ｜ ${turn.kind}${roundTag}\n`);
      lines.push(turn.text + '\n');
    } else {
      const roundTag = turn.round !== null ? ` (第 ${turn.round} 輪)` : '';
      lines.push(`### ${turn.speaker} ｜ ${turn.kind}${roundTag}\n`);
      lines.push(turn.text + '\n');
      if (turn.claims && turn.claims.length) {
        lines.push('> 提出論點：' + turn.claims.map((cid) => `\`#${cid}\``).join(', ') + '\n');
      }
    }
    lines.push('---\n');
  }

  lines.push('## 最終論點索引表\n');
  lines.push(renderClaimsIndex(state) + '\n');

  lines.push('## 辯手計分板\n');
  lines.push('| 辯手 | 論點數 | 攻擊命中 | 主動讓步 | 被標謬誤 | 查核標記 | MVP得分 |');
  lines.push('|---|---:|---:|---:|---:|---:|---:|');
  const board = computeScoreboard(state);
  for (const sp of Object.keys(board)) {
    const s = board[sp];
    lines.push(`| ${s.speaker} | ${s.claims_count} | ${s.attacks_landed} | ${s.concessions_made} | ${s.fallacies_flagged} | ${s.fact_flags} | **${s.mvp_score}** |`);
  }

  return lines.join('\n');
}

// CLI Execution
if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`) {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      question: { type: 'string' },
      brief: { type: 'string' },
      speaker: { type: 'string' },
      kind: { type: 'string' },
      round: { type: 'string' },
      file: { type: 'string' },
      out: { type: 'string' },
    },
    allowPositionals: true,
  });

  const cmd = positionals[0];
  const statePath = positionals[1];

  if (!cmd || !statePath) {
    console.error('用法：node ledger.mjs <init|turn|chair|facts|fallacies|index|scoreboard|transcript> <state.json> [選項]');
    process.exit(2);
  }

  if (cmd === 'init') {
    let brief = null;
    if (values.brief && existsSync(values.brief)) {
      brief = JSON.parse(readFileSync(values.brief, 'utf-8'));
    }
    const state = createInitialState(values.question || '技術選型辯論', brief);
    saveState(statePath, state);
    console.log(JSON.stringify({ ok: true, message: `Initialized ledger at ${statePath}` }, null, 2));
    process.exit(0);
  }

  const state = loadState(statePath);

  if (cmd === 'chair') {
    const text = values.file ? readFileSync(values.file, 'utf-8') : positionals[2] || '';
    const round = values.round ? parseInt(values.round, 10) : null;
    addChairTurn(state, { kind: values.kind || 'speech', round, text });
    saveState(statePath, state);
    console.log(JSON.stringify({ ok: true, message: 'Chair turn recorded' }));
  } else if (cmd === 'turn') {
    const text = values.file ? readFileSync(values.file, 'utf-8') : positionals[2] || '';
    const round = values.round ? parseInt(values.round, 10) : null;
    const res = addDebaterTurn(state, {
      speaker: values.speaker || 'unknown',
      kind: values.kind || 'rebuttal',
      round,
      text,
    });
    saveState(statePath, state);
    console.log(JSON.stringify({ ok: true, new_claims: res.new_claims.length, turn_id: res.turn.id }, null, 2));
  } else if (cmd === 'facts') {
    const checks = JSON.parse(readFileSync(values.file, 'utf-8'));
    recordFactChecks(state, Array.isArray(checks) ? checks : checks.checks || []);
    saveState(statePath, state);
    console.log(JSON.stringify({ ok: true, message: 'Fact checks recorded' }));
  } else if (cmd === 'fallacies') {
    const fallacies = JSON.parse(readFileSync(values.file, 'utf-8'));
    recordFallacies(state, Array.isArray(fallacies) ? fallacies : fallacies.fallacies || []);
    saveState(statePath, state);
    console.log(JSON.stringify({ ok: true, message: 'Fallacies recorded' }));
  } else if (cmd === 'index') {
    console.log(renderClaimsIndex(state));
  } else if (cmd === 'scoreboard') {
    console.log(JSON.stringify(computeScoreboard(state), null, 2));
  } else if (cmd === 'transcript') {
    const md = generateTranscriptMarkdown(state);
    if (values.out) {
      writeFileSync(values.out, md, 'utf-8');
      console.log(`Transcript written to ${values.out}`);
    } else {
      console.log(md);
    }
  } else {
    console.error(`未知子命令：${cmd}`);
    process.exit(1);
  }
}
