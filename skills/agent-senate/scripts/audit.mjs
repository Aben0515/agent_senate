#!/usr/bin/env node
/**
 * audit.mjs — Deterministic audit of a debate run directory.
 * Checks: verdict vs computed winner, confidence band, close-call warning,
 * highlight quotes are contiguous text from ONE turn, evidence claim ids,
 * round count, chair speeches present, analysis.json freshness, report.md.
 *
 * Usage: node audit.mjs <run-dir>     exit 0 = no high issues, 1 = failed
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import {
  readJson, readText, isMain, runCli, UsageError, confidenceLabel, normalizeVerdict, normalizeHighlight, canonicalSpeaker,
  normalizeClaimId,
} from './common.mjs';
import { inputDigest } from './analyze.mjs';
import { closeCallReasons } from './report.mjs';

export function normalizeText(str) {
  if (!str) return '';
  return String(str)
    .replace(/\s+/g, '')
    .replace(/[，。！？；：「」『』（）()【】《》〈〉、,.!?;:"'“”‘’*_`>#—–-]/g, '')
    .toLowerCase();
}

/** Split a quote on ellipses; every segment must appear, in order, inside the same source text. */
export function quoteAppearsIn(quote, source) {
  const segments = String(quote).split(/…+|\.{3,}|⋯+/).map(normalizeText).filter(Boolean);
  if (!segments.length) return true;
  const hay = normalizeText(source);
  let from = 0;
  for (const seg of segments) {
    const at = hay.indexOf(seg, from);
    if (at < 0) return false;
    from = at + seg.length;
  }
  return true;
}

function safe(fn) {
  try {
    return fn();
  } catch {
    return null;
  }
}

export function auditRunDirectory(runDir) {
  const issues = [];
  const add = (severity, location, problem, fix) => issues.push({ severity, location, problem, fix });
  const file = (name) => join(runDir, name);
  const json = (name) => (existsSync(file(name)) ? safe(() => readJson(file(name))) : null);
  const text = (name) => (existsSync(file(name)) ? safe(() => readText(file(name))) ?? '' : '');

  const state = json('state.json');
  const rawAnalysis = json('analysis.json');
  const input = json('input.json');
  const reportMd = text('report.md');
  const transcriptMd = text('transcript.md');

  if (!rawAnalysis) {
    add('high', 'analysis.json', '缺少或無法解析 analysis.json。', '請先執行 analyze.mjs 產生數學分析結果。');
    return { passed: false, issues };
  }
  const analysis = rawAnalysis.analysis || rawAnalysis;
  const extras = input?.extras || {};
  const verdict = normalizeVerdict(extras.verdict);
  const winner = analysis.winner || '';

  // 0. analysis.json must be computed from the current input.json.
  if (input && analysis.input_digest) {
    const now = safe(() => inputDigest(input));
    if (now && now !== analysis.input_digest) {
      add('high', 'analysis.json', 'analysis.json 不是由目前的 input.json 算出來的（評分或權重在計算後被改過）。', '重新執行 analyze.mjs，再重產 report.md。');
    }
  }

  // 1. Winner alignment
  if (verdict.recommended_option_id && winner && verdict.recommended_option_id !== winner) {
    add('high', 'extras.verdict.recommended_option_id',
      `判決推薦方案 \`${verdict.recommended_option_id}\` 與數學計算贏家 \`${winner}\` 不一致！`,
      `必須將推薦方案改為數學贏家 \`${winner}\`。`);
  }

  // 2. Confidence band (≥75% 高, 50–75% 中, <50% 低)
  const p = analysis.win_probability?.[winner] ?? 0;
  const expected = confidenceLabel(p);
  if (verdict.confidence_label && verdict.confidence_label !== expected) {
    add('medium', 'extras.verdict.confidence_label',
      `勝率為 ${Math.round(p * 100)}%，信心評級應為「${expected}」，但判決寫「${verdict.confidence_label}」。`,
      `將信心評級改為「${expected}」。`);
  }

  // 3. Close call must be disclosed
  const close = closeCallReasons(analysis);
  if (close.length && reportMd && !reportMd.includes('過於接近')) {
    add('medium', 'report.md', `結果過於接近（${close.join('；')}），但報告沒有明說。`, '用 report.mjs 重新產生報告，並把「下一步驗證實驗」放在最前面。');
  }

  // 4. Highlight quotes: contiguous text inside ONE debater turn (no splicing across turns).
  const debaterTurns = (state?.turns || []).filter((t) => t.type === 'debater');
  const speakers = new Set(debaterTurns.map((t) => canonicalSpeaker(t.speaker)));
  for (const [idx, raw] of (extras.highlights || []).entries()) {
    const hl = normalizeHighlight(raw);
    if (!hl.quote) continue;
    let ok;
    let sameSpeaker = true;
    if (debaterTurns.length) {
      const hits = debaterTurns.filter((t) => quoteAppearsIn(hl.quote, t.text || t.full_text || ''));
      ok = hits.length > 0;
      if (ok && hl.speaker_id && speakers.has(canonicalSpeaker(hl.speaker_id))) {
        sameSpeaker = hits.some((t) => canonicalSpeaker(t.speaker) === canonicalSpeaker(hl.speaker_id));
      }
    } else {
      ok = quoteAppearsIn(hl.quote, transcriptMd);
    }
    if (!ok) {
      add('high', `extras.highlights[${idx}].quote`,
        `高光引言「${hl.quote}」並非單一發言中的連續原文（疑似拼接、改寫或虛構）。`,
        '必須從同一則發言中選取連續的一段原文逐字引用，若有省略應標註「…」。');
    } else if (!sameSpeaker) {
      add('medium', `extras.highlights[${idx}].speaker_id`,
        `高光引言出自其他辯手，不是 \`${hl.speaker_id}\` 說的。`, '更正 speaker_id。');
    }
  }

  // 5. Evidence validity
  const knownClaims = state?.claims || {};
  const haveClaims = Object.keys(knownClaims).length > 0;
  for (const [sIdx, sample] of (input?.chairSamples || []).entries()) {
    for (const c of sample?.cells || []) {
      for (const rawId of c?.evidence_claim_ids || []) {
        const cid = normalizeClaimId(rawId);
        const claim = knownClaims[cid];
        const loc = `input.chairSamples[${sIdx}].cells[${c.option_id}|${c.criterion_id}]`;
        if (!claim) {
          if (haveClaims) add('high', loc, `引用了不存在的論點編號：\`#${cid}\``, '移除無效引用或替換為正確的論點編號。');
        } else if (claim.status === 'conceded') {
          add('high', loc, `引用了已被讓步的論點作為支持證據：\`#${cid}\``, '不可使用已被讓步的論點作為評分依據，請更換證據論點。');
        } else if (claim.status === 'disputed_fact') {
          add('high', loc, `引用了已被事實查核判定可能錯誤的論點：\`#${cid}\``, '更換為合理的事實論點。');
        }
      }
    }
  }

  // 6. Debate completeness (from the ledger, not from string matching)
  if (state?.turns) {
    const chairTurns = state.turns.filter((t) => t.type === 'chair');
    if (!chairTurns.some((t) => t.kind === 'opening')) {
      add('medium', 'state.turns', '記帳本沒有主席開場白。', '用 `ledger.mjs chair --kind opening` 記錄開場白。');
    }
    const rebuttalRounds = new Set(debaterTurns.filter((t) => t.kind === 'rebuttal' && Number.isInteger(t.round)).map((t) => t.round));
    if (rebuttalRounds.size < 2) {
      add('medium', 'state.turns', `交叉質詢僅記錄了 ${rebuttalRounds.size} 輪，規格要求至少進行 2 輪。`, '請依規定完整執行第 2 輪交叉質詢（登記發言時帶 --round）。');
    }
    const directiveRounds = new Set(chairTurns.filter((t) => t.kind === 'directive').map((t) => t.round));
    for (const r of rebuttalRounds) {
      if (!directiveRounds.has(r)) add('medium', 'state.turns', `第 ${r} 輪交叉質詢沒有記錄主席指令。`, `用 \`ledger.mjs chair --kind directive --round ${r}\` 記錄。`);
    }
    const noClosing = [...speakers].filter((sp) => !debaterTurns.some((t) => t.kind === 'closing' && canonicalSpeaker(t.speaker) === sp));
    if (noClosing.length) add('medium', 'state.turns', `下列辯手沒有結辯：${noClosing.join(', ')}`, '補上結辯並登記進記帳本。');
  } else if (transcriptMd && !transcriptMd.includes('天秤主席')) {
    add('medium', 'transcript.md', '逐字稿缺少主席開場白或主席指令。', '逐字稿必須完整記錄主席的開場白與每一輪的主持指令。');
  }

  // 7. Deliverables
  if (!transcriptMd) add('medium', 'transcript.md', '缺少 transcript.md。', '執行 `ledger.mjs transcript`。');
  if (!reportMd) {
    add('medium', 'report.md', '缺少 report.md。', '執行 report.mjs 產生報告。');
  } else if (winner && !reportMd.includes(`\`${winner}\``)) {
    add('high', 'report.md', `report.md 沒有提到程式計算的贏家 \`${winner}\`（可能是舊版或手寫報告）。`, '用 report.mjs 重新產生。');
  } else if (analysis.seed_used !== undefined && !reportMd.includes(`隨機種子：${analysis.seed_used}`)) {
    add('high', 'report.md', 'report.md 不是由目前的 analysis.json 產生（隨機種子不符，數字可能過期）。', '在最後一次 analyze.mjs 之後重新執行 report.mjs。');
  }

  // 8. MVP must be an actual debater
  const mvp = extras.mvp?.speaker_id ?? extras.mvp?.speaker;
  if (mvp && speakers.size && !speakers.has(canonicalSpeaker(mvp))) {
    add('low', 'extras.mvp.speaker_id', `MVP \`${mvp}\` 不是本場辯手。`, '改成實際參賽辯手的 persona id。');
  }

  const passed = !issues.some((i) => i.severity === 'high');
  return { passed, issues };
}

async function main() {
  const { positionals } = parseArgs({ args: process.argv.slice(2), allowPositionals: true });
  const runDir = positionals[0];
  if (!runDir) throw new UsageError('用法：node audit.mjs <run-dir>');
  if (!existsSync(runDir)) throw new Error(`找不到資料夾：${runDir}`);
  const result = auditRunDirectory(runDir);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.passed ? 0 : 1);
}

if (isMain(import.meta.url)) runCli(main);
