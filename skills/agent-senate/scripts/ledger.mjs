#!/usr/bin/env node
/**
 * ledger.mjs — Deterministic debate ledger.
 * Tracks speech turns, chair speeches, fact checks, fallacies, the claim graph
 * (ids, attacks, concessions, status) and renders the transcript.
 *
 * Usage: node ledger.mjs <init|turn|chair|facts|fallacies|index|scoreboard|transcript> <state.json> [options]
 */

import { writeFileSync, existsSync } from 'node:fs';
import { parseArgs } from 'node:util';
import {
  PERSONAS, canonicalSpeaker, speakerPrefix, parseInTextRefs, isClaimId,
  readJson, readText, isMain, runCli, UsageError,
} from './common.mjs';
import { extractJsonFromText, normalizeRawClaim, VALID_KINDS, CLAIMS_BLOCK_RE } from './validate.mjs';

/** Kept for backwards compatibility; the source of truth is PERSONAS in common.mjs. */
export const SPEAKER_PREFIXES = Object.fromEntries(
  Object.entries(PERSONAS).flatMap(([id, p]) => [[id, p.prefix], [p.prefix, p.prefix]]),
);

export function getSpeakerPrefix(speakerId) {
  return speakerPrefix(speakerId);
}

export const TURN_KINDS = ['opening', 'rebuttal', 'steelman', 'closing'];
export const CHAIR_KINDS = ['opening', 'directive', 'devil_advocate', 'verdict', 'speech'];
export const FACT_VERDICTS = ['plausible', 'questionable', 'likely_false', 'unverifiable'];

const KIND_LABELS = {
  opening: '開場陳述',
  rebuttal: '交叉質詢',
  steelman: '鋼人論證',
  closing: '結辯',
  directive: '主席指令',
  devil_advocate: '指派魔鬼代言人',
  verdict: '判決',
  speech: '發言',
  factcheck: '事實查核',
};

export function createInitialState(question, brief = null) {
  return {
    version: 2,
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
  if (!existsSync(statePath)) throw new Error(`找不到記帳本：${statePath}（請先執行 ledger.mjs init）`);
  return readJson(statePath, 'state.json');
}

export function saveState(statePath, state) {
  writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf8');
}

function uniqueTurnId(state, base) {
  const used = new Set(state.turns.map((t) => t.id));
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}

function normRound(round) {
  if (round === null || round === undefined || round === '') return null;
  const n = Number(round);
  if (!Number.isInteger(n) || n < 1) throw new Error(`round 必須是正整數，收到：${round}`);
  return n;
}

export function addChairTurn(state, { kind = 'speech', round = null, text }) {
  if (!text || !String(text).trim()) throw new Error('主席發言內容為空。');
  const r = normRound(round);
  const turn = {
    id: uniqueTurnId(state, `chair_${kind}_${r !== null ? r : state.chair_events.length + 1}`),
    type: 'chair',
    kind,
    round: r,
    text: String(text).trim(),
    timestamp: new Date().toISOString(),
  };
  state.chair_events.push(turn);
  state.turns.push(turn);
  return turn;
}

/**
 * Register a debater turn. Claim ids are always assigned here (`前綴.序號`);
 * ids written by the model are ignored.
 *
 * Semantics:
 *  - attacks: the claim attacks an existing claim of ANOTHER speaker.
 *  - concessions (`【讓步 #id】` or `concedes`): the speaker withdraws one of
 *    their OWN claims → status `conceded` (it can no longer be used as evidence).
 *    Conceding another speaker's claim is recorded as an acknowledgement only.
 */
export function addDebaterTurn(state, { speaker, kind = 'rebuttal', round = null, text }) {
  if (!text || !String(text).trim()) throw new Error('辯手發言內容為空。');
  const speakerId = canonicalSpeaker(speaker);
  const prefix = speakerPrefix(speakerId);
  const r = normRound(round);
  const warnings = [];
  if (!TURN_KINDS.includes(kind)) warnings.push(`未知的發言類型 kind=${kind}（應為 ${TURN_KINDS.join(' / ')}）`);
  if (kind === 'rebuttal' && r === null) warnings.push('交叉質詢發言未帶 --round，稽核無法計算輪數。');
  state.speaker_counters[prefix] ??= 0;

  // 1. Parse the claims block.
  let rawClaims = [];
  const match = CLAIMS_BLOCK_RE.exec(text);
  if (match) {
    let parsed;
    try {
      parsed = extractJsonFromText(match[1]);
    } catch (e) {
      throw new Error(`發言中的 \`\`\`claims 區塊 JSON 解析失敗: ${e.message}`);
    }
    rawClaims = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.claims) ? parsed.claims : [];
  } else {
    warnings.push('發言沒有 ```claims 區塊，本回合不新增論點。');
  }
  const body = text.replace(CLAIMS_BLOCK_RE, '').trim();

  // Validate everything before mutating state, so a bad turn leaves the ledger untouched.
  const normalized = rawClaims.map((raw, i) => {
    const c = normalizeRawClaim(raw);
    if (!c.text) throw new Error(`claims[${i}] 缺少 text：${JSON.stringify(raw)}`);
    const k = c.kind || 'value';
    if (!VALID_KINDS.includes(k)) throw new Error(`無效的 claim kind: \`${raw.kind}\`。只能是：${VALID_KINDS.join(', ')}`);
    c.kind = k;
    if (!c.quote) {
      warnings.push(`claims[${i}] 缺少 quote，以 text 代替。`);
      c.quote = c.text;
    } else if (!body.includes(c.quote)) {
      warnings.push(`claims[${i}] 的 quote 不是發言本文中的逐字原文：「${c.quote}」`);
    }
    return c;
  });

  const ownClaim = (id) => state.claims[id] && state.claims[id].speaker === speakerId;
  const usableRef = (id, label) => {
    if (!isClaimId(id)) {
      warnings.push(`${label}編號格式錯誤：${id}`);
      return false;
    }
    if (!state.claims[id]) {
      warnings.push(`${label}的論點不存在於索引：${id}`);
      return false;
    }
    return true;
  };

  // 2. Register new claims with explicit attacks.
  const inText = parseInTextRefs(body);
  const registered = [];
  const explicitlyAttacked = new Set();
  for (const c of normalized) {
    state.speaker_counters[prefix] += 1;
    const claimId = `${prefix}.${state.speaker_counters[prefix]}`;
    const attacks = [];
    for (const a of c.attacks) {
      if (!usableRef(a, '攻擊')) continue;
      if (ownClaim(a)) {
        warnings.push(`${claimId} 攻擊的是自己的論點 ${a}，已忽略。`);
        continue;
      }
      if (!attacks.includes(a)) attacks.push(a);
      explicitlyAttacked.add(a);
    }
    const claim = {
      id: claimId,
      speaker: speakerId,
      turn_kind: kind,
      round: r,
      text: c.text,
      quote: c.quote,
      kind: c.kind,
      supports_option_ids: c.supports,
      attacks_claim_ids: attacks,
      concedes_claim_ids: [],
      status: 'open',
      attacked_by: [],
      acknowledged_by: [],
      fact_check: null,
    };
    state.claims[claimId] = claim;
    registered.push(claim);
  }

  // In-text quote references that no claim declared explicitly: attribute them to the
  // turn's first new claim, so the attack still shows up in the claim graph.
  for (const ref of inText.references) {
    if (explicitlyAttacked.has(ref) || !state.claims[ref] || ownClaim(ref)) continue;
    if (registered.some((c) => c.id === ref)) continue;
    if (registered.length) registered[0].attacks_claim_ids.push(ref);
    explicitlyAttacked.add(ref);
  }

  // 3. Apply attacks.
  const attackedNow = [];
  for (const c of registered) {
    for (const targetId of c.attacks_claim_ids) {
      const target = state.claims[targetId];
      target.attacked_by ??= [];
      if (!target.attacked_by.includes(c.id)) target.attacked_by.push(c.id);
      // Only open/plausible claims become "attacked"; conceded and disputed_fact are stronger states.
      if (target.status === 'open' || target.status === 'plausible') target.status = 'attacked';
      attackedNow.push(targetId);
    }
  }
  if (!registered.length) {
    for (const ref of inText.references) {
      if (state.claims[ref] && !ownClaim(ref)) attackedNow.push(ref);
    }
  }

  // 4. Apply concessions (turn level, so they also work in turns without claims).
  const concessionIds = [...new Set([...inText.concessions, ...normalized.flatMap((c) => c.concedes)])];
  const conceded = [];
  const acknowledged = [];
  for (const id of concessionIds) {
    if (!usableRef(id, '讓步')) continue;
    const target = state.claims[id];
    if (target.speaker === speakerId) {
      target.status = 'conceded';
      target.conceded_in = null; // filled below once the turn id is known
      conceded.push(id);
    } else {
      target.acknowledged_by ??= []; // ledgers written by v0.3.0 lack this field
      if (!target.acknowledged_by.includes(speakerId)) target.acknowledged_by.push(speakerId);
      acknowledged.push(id);
      warnings.push(`讓步只能針對自己的論點；${id} 屬於 ${target.speaker}，已記為「承認對手論點」而非讓步。`);
    }
  }
  if (registered.length && conceded.length) registered[0].concedes_claim_ids = conceded;

  const turn = {
    id: uniqueTurnId(state, `turn_${speakerId}_${kind}_${r !== null ? r : state.turns.length + 1}`),
    type: 'debater',
    speaker: speakerId,
    kind,
    round: r,
    text: body,
    full_text: text,
    claims: registered.map((c) => c.id),
    attacks: [...new Set(attackedNow)],
    concessions: conceded,
    acknowledgements: acknowledged,
    timestamp: new Date().toISOString(),
  };
  for (const id of conceded) state.claims[id].conceded_in = turn.id;
  state.turns.push(turn);

  const totalConceded = Object.values(state.claims).filter((c) => c.speaker === speakerId && c.status === 'conceded').length;
  if (totalConceded > 1) warnings.push(`${speakerId} 已累計讓步 ${totalConceded} 次，超過鐵律 12 的上限（1 次），主席應點名。`);

  return { turn, new_claims: registered, warnings };
}

export function recordFactChecks(state, checks, { round = null } = {}) {
  const warnings = [];
  const r = normRound(round);
  const recorded = [];
  for (const fc of checks) {
    if (!fc || typeof fc !== 'object') continue;
    const id = String(fc.claim_id ?? '').trim();
    const verdict = String(fc.verdict ?? '').trim().toLowerCase();
    if (!FACT_VERDICTS.includes(verdict)) {
      warnings.push(`查核 ${id} 的 verdict 無效：${fc.verdict}（應為 ${FACT_VERDICTS.join(' / ')}）`);
      continue;
    }
    const entry = { ...fc, claim_id: id, verdict, round: fc.round ?? r };
    const claim = state.claims[id];
    if (!claim) {
      warnings.push(`查核的論點不存在於索引：${id}`);
    } else {
      claim.fact_check = entry;
      if (verdict === 'likely_false' && claim.status !== 'conceded') claim.status = 'disputed_fact';
      else if (verdict === 'plausible' && claim.status === 'open') claim.status = 'plausible';
    }
    state.fact_checks.push(entry);
    recorded.push(entry);
  }
  if (recorded.length) {
    const lines = recorded.map((fc) => {
      const icon = { plausible: '✅', questionable: '⚠️', likely_false: '❌', unverifiable: '❔' }[fc.verdict];
      return `- ${icon} #${fc.claim_id} ${fc.verdict}${fc.note ? `：${fc.note}` : ''}${fc.correct_magnitude ? `（合理量級：${fc.correct_magnitude}）` : ''}`;
    });
    state.turns.push({
      id: uniqueTurnId(state, `factcheck_${r !== null ? r : state.turns.length + 1}`),
      type: 'factcheck',
      kind: 'factcheck',
      round: r,
      text: lines.join('\n'),
      timestamp: new Date().toISOString(),
    });
  }
  return { recorded: recorded.length, warnings };
}

export function recordFallacies(state, fallacies) {
  const warnings = [];
  for (const fa of fallacies) {
    if (!fa || typeof fa !== 'object') continue;
    const entry = { ...fa };
    if (!entry.speaker_id && entry.claim_id && state.claims[entry.claim_id]) {
      entry.speaker_id = state.claims[entry.claim_id].speaker;
    }
    if (!entry.speaker_id) {
      warnings.push(`謬誤缺少 speaker_id 且無法由 claim_id 推得：${JSON.stringify(fa)}`);
      continue;
    }
    entry.speaker_id = canonicalSpeaker(entry.speaker_id);
    if (entry.claim_id && !state.claims[entry.claim_id]) warnings.push(`謬誤指向的論點不存在：${entry.claim_id}`);
    state.fallacies.push(entry);
  }
  return { warnings };
}

const STATUS_BADGES = {
  open: '⏳開放',
  attacked: '⚔️被攻擊',
  conceded: '💔已讓步',
  disputed_fact: '❌可能錯誤',
  plausible: '✅合理',
};

export function speakerName(id) {
  const p = PERSONAS[id];
  return p ? `${p.emoji} ${p.short_name}` : id;
}

export function renderClaimsIndex(state) {
  const claims = Object.values(state.claims || {});
  if (!claims.length) return '（目前尚無論點記錄）';
  return claims
    .map((c) => {
      const badge = STATUS_BADGES[c.status] || c.status;
      const fc = c.fact_check?.verdict === 'questionable' ? ' [⚠️存疑]' : c.fact_check?.verdict === 'unverifiable' ? ' [❔無法查證]' : '';
      const attacked = c.attacked_by?.length ? ` (⚔️來自: ${c.attacked_by.join(', ')})` : '';
      const ack = c.acknowledged_by?.length ? ` (🤝被承認: ${c.acknowledged_by.join(', ')})` : '';
      return `- #${c.id} (${c.kind}, ${c.speaker}) [${badge}]${fc}${attacked}${ack} ${c.text} ／ 原文：「${c.quote}」`;
    })
    .join('\n');
}

/** Next claim id per speaker (useful when the chair briefs a debater). */
export function nextClaimIds(state, speakers = null) {
  const list = speakers ?? [...new Set((state.turns || []).filter((t) => t.type === 'debater').map((t) => t.speaker))];
  return Object.fromEntries(list.map((s) => {
    const p = speakerPrefix(s);
    return [canonicalSpeaker(s), `${p}.${(state.speaker_counters?.[p] ?? 0) + 1}`];
  }));
}

export function computeScoreboard(state) {
  const board = {};
  const ensure = (sp) => {
    board[sp] ??= { speaker: sp, claims_count: 0, attacks_landed: 0, concessions_made: 0, fallacies_flagged: 0, fact_flags: 0, mvp_score: 0 };
    return board[sp];
  };
  for (const t of state.turns || []) if (t.type === 'debater') ensure(canonicalSpeaker(t.speaker));

  const claims = state.claims || {};
  for (const c of Object.values(claims)) {
    const sp = canonicalSpeaker(c.speaker);
    if (!board[sp]) continue;
    const s = board[sp];
    s.claims_count++;
    if (c.status === 'conceded') s.concessions_made++;
    if (['questionable', 'likely_false'].includes(c.fact_check?.verdict)) s.fact_flags++;
    // Attack landed: the target was later conceded or found likely false.
    for (const targetId of c.attacks_claim_ids || []) {
      if (['conceded', 'disputed_fact'].includes(claims[targetId]?.status)) s.attacks_landed++;
    }
  }
  for (const fa of state.fallacies || []) {
    const sp = canonicalSpeaker(fa.speaker_id);
    if (board[sp]) board[sp].fallacies_flagged++;
  }
  for (const s of Object.values(board)) {
    s.mvp_score = s.attacks_landed * 3 + s.concessions_made - s.fallacies_flagged * 2 - s.fact_flags * 2;
  }
  return board;
}

export function generateTranscriptMarkdown(state) {
  const lines = [];
  lines.push(`# 完整辯論逐字稿：${state.question}\n`);
  lines.push(`> 建立時間：${state.created_at}\n`);

  const brief = state.brief;
  if (brief) {
    lines.push('## 決策簡報與情境約束\n');
    lines.push(`- **問題**：${brief.restated_question || state.question}`);
    if (brief.options?.length) {
      lines.push('- **候選方案**：' + brief.options.map((o) => `\`${o.id}\` (${o.label})`).join('、'));
    }
    if (brief.context_facts?.length) {
      lines.push('- **情境事實**：\n' + brief.context_facts.map((f) => `  - ${f}`).join('\n'));
    }
    if (brief.assumptions?.length) {
      lines.push('- **預設假設**：\n' + brief.assumptions.map((a) => `  - ${typeof a === 'string' ? a : a.text}`).join('\n'));
    }
    if (brief.criteria?.length) {
      lines.push('- **評估準則**：' + brief.criteria.map((c) => `\`${c.id}\` ${c.label}`).join('、'));
    }
    lines.push('\n---\n');
  }

  lines.push('## 辯論完整進程\n');
  for (const turn of state.turns || []) {
    const roundTag = turn.round !== null && turn.round !== undefined ? `（第 ${turn.round} 輪）` : '';
    const kindLabel = KIND_LABELS[turn.kind] || turn.kind;
    if (turn.type === 'chair') {
      lines.push(`### ⚖️ 天秤主席 ｜ ${kindLabel}${roundTag}\n`);
      lines.push(turn.text + '\n');
    } else if (turn.type === 'factcheck') {
      lines.push(`### 🔎 事實查核${roundTag}\n`);
      lines.push(turn.text + '\n');
    } else {
      lines.push(`### ${speakerName(turn.speaker)} ｜ ${kindLabel}${roundTag}\n`);
      lines.push(turn.text + '\n');
      const notes = [];
      if (turn.claims?.length) notes.push('提出論點：' + turn.claims.map((cid) => `\`#${cid}\``).join(', '));
      if (turn.attacks?.length) notes.push('⚔️ 攻擊：' + turn.attacks.map((cid) => `\`#${cid}\``).join(', '));
      if (turn.concessions?.length) notes.push('💔 讓步：' + turn.concessions.map((cid) => `\`#${cid}\``).join(', '));
      if (notes.length) lines.push('> ' + notes.join(' ｜ ') + '\n');
    }
    lines.push('---\n');
  }

  if (state.fallacies?.length) {
    lines.push('## 🚩 謬誤點名紀錄\n');
    for (const fa of state.fallacies) {
      lines.push(`- ${speakerName(fa.speaker_id)}${fa.claim_id ? ` #${fa.claim_id}` : ''}：${fa.type ?? ''}${fa.explanation || fa.note ? ` — ${fa.explanation || fa.note}` : ''}`);
    }
    lines.push('');
  }

  lines.push('## 最終論點索引表\n');
  lines.push(renderClaimsIndex(state) + '\n');

  lines.push('## 辯手計分板\n');
  lines.push('| 辯手 | 論點數 | 攻擊命中 | 主動讓步 | 被標謬誤 | 查核標記 | MVP得分 |');
  lines.push('|---|---:|---:|---:|---:|---:|---:|');
  for (const s of Object.values(computeScoreboard(state))) {
    lines.push(`| ${speakerName(s.speaker)} | ${s.claims_count} | ${s.attacks_landed} | ${s.concessions_made} | ${s.fallacies_flagged} | ${s.fact_flags} | **${s.mvp_score}** |`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------- CLI

const USAGE = `用法：node ledger.mjs <init|turn|chair|facts|fallacies|index|next-ids|scoreboard|transcript> <state.json> [選項]
  init       <state.json> --question "<題目>" [--brief brief.json] [--force]
  chair      <state.json> --kind <opening|directive|devil_advocate|verdict> [--round N] --file <chair.md>
  turn       <state.json> --speaker <persona_id> --kind <opening|rebuttal|steelman|closing> [--round N] --file <turn.md>
  facts      <state.json> --file <factcheck.json> [--round N]
  fallacies  <state.json> --file <fallacies.json>
  next-ids   <state.json> [--speaker conservative_cto,perf_zealot]
  index | scoreboard <state.json>
  transcript <state.json> [--out transcript.md]`;

function readInput(values, positionals, what) {
  if (values.file) return readText(values.file, '--file');
  if (positionals[2]) return positionals[2];
  throw new UsageError(`${what}需要 --file <檔案>。\n${USAGE}`);
}

function readListJson(values, key) {
  if (!values.file) throw new UsageError(`需要 --file <json>。\n${USAGE}`);
  const raw = readText(values.file, '--file');
  const parsed = extractJsonFromText(raw);
  return Array.isArray(parsed) ? parsed : parsed[key] || [];
}

async function main() {
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
      force: { type: 'boolean' },
    },
    allowPositionals: true,
  });

  const cmd = positionals[0];
  const statePath = positionals[1];
  if (!cmd || !statePath) throw new UsageError(USAGE);

  const print = (obj) => console.log(JSON.stringify(obj, null, 2));

  if (cmd === 'init') {
    if (existsSync(statePath) && !values.force) {
      throw new Error(`${statePath} 已存在。若確定要清空重來，加上 --force。`);
    }
    const brief = values.brief ? readJson(values.brief, '--brief') : null;
    const question = values.question || brief?.restated_question || '技術選型辯論';
    saveState(statePath, createInitialState(question, brief));
    print({ ok: true, message: `Initialized ledger at ${statePath}` });
    return;
  }

  const state = loadState(statePath);
  if (cmd === 'chair') {
    const turn = addChairTurn(state, { kind: values.kind || 'speech', round: values.round, text: readInput(values, positionals, '主席發言') });
    saveState(statePath, state);
    print({ ok: true, turn_id: turn.id });
  } else if (cmd === 'turn') {
    if (!values.speaker) throw new UsageError(`turn 需要 --speaker <persona_id>。\n${USAGE}`);
    const res = addDebaterTurn(state, {
      speaker: values.speaker,
      kind: values.kind || 'rebuttal',
      round: values.round,
      text: readInput(values, positionals, '辯手發言'),
    });
    saveState(statePath, state);
    print({
      ok: true,
      turn_id: res.turn.id,
      new_claims: res.new_claims.map((c) => c.id),
      attacks: res.turn.attacks,
      concessions: res.turn.concessions,
      warnings: res.warnings,
    });
  } else if (cmd === 'facts') {
    const res = recordFactChecks(state, readListJson(values, 'checks'), { round: values.round });
    saveState(statePath, state);
    print({ ok: true, ...res });
  } else if (cmd === 'fallacies') {
    const res = recordFallacies(state, readListJson(values, 'fallacies'));
    saveState(statePath, state);
    print({ ok: true, ...res });
  } else if (cmd === 'index') {
    console.log(renderClaimsIndex(state));
  } else if (cmd === 'next-ids') {
    print(nextClaimIds(state, values.speaker ? values.speaker.split(',').map((x) => x.trim()).filter(Boolean) : null));
  } else if (cmd === 'scoreboard') {
    print(computeScoreboard(state));
  } else if (cmd === 'transcript') {
    const md = generateTranscriptMarkdown(state);
    if (values.out) {
      writeFileSync(values.out, md, 'utf8');
      console.log(`Transcript written to ${values.out}`);
    } else {
      console.log(md);
    }
  } else {
    throw new UsageError(`未知子命令：${cmd}\n${USAGE}`);
  }
}

if (isMain(import.meta.url)) runCli(main);
