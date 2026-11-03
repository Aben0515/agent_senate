#!/usr/bin/env node
/**
 * validate.mjs — Deterministic validation for subagent outputs:
 * - judge:   neutral judge scoring JSON (template E)
 * - persona: debater scoring JSON (template D)
 * - turn:    debater speech markdown + ```claims block (template A)
 *
 * Usage:
 *   node validate.mjs judge   <brief.json> <judge-output> [--ledger state.json] [--write-clean out.json]
 *   node validate.mjs persona <brief.json> <persona-output> --speaker <id> [--ledger state.json] [--write-clean out.json]
 *   node validate.mjs turn    <turn.md> [--ledger state.json]
 * Exit code: 0 = ok, 1 = validation failed, 2 = usage error.
 */

import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import {
  readJson, readText, isMain, runCli, UsageError, canonicalSpeaker, parseInTextRefs, isClaimId, normalizeClaimId,
} from './common.mjs';

export const VALID_KINDS = ['fact', 'estimate', 'value', 'prediction', 'proposal'];
export const CLAIMS_BLOCK_RE = /```claims[^\S\n]*\n?([\s\S]*?)```/i;
const ANY_FENCE_RE = /```([a-zA-Z]*)[^\S\n]*\n?([\s\S]*?)```/g;
const BOM = String.fromCharCode(0xfeff);

/**
 * Locate the claims block of a debater turn.
 * Returns { status: 'ok' | 'missing' | 'unclosed', json, block, fallback } where
 * `block` is the exact text to strip from the speech body.
 *  - ```claims … ``` (preferred)
 *  - a trailing ```json … ``` fence whose content is an array (common model slip)
 *  - ```claims without a closing fence (truncated output) → 'unclosed'
 */
export function findClaimsBlock(text) {
  const src = String(text ?? '');
  const m = CLAIMS_BLOCK_RE.exec(src);
  if (m) return { status: 'ok', json: m[1], block: m[0], fallback: false };
  if (/```claims/i.test(src)) return { status: 'unclosed', json: null, block: null, fallback: false };
  const fences = [...src.matchAll(ANY_FENCE_RE)].filter((f) => !f[1] || /^json$/i.test(f[1]));
  const last = fences[fences.length - 1];
  if (last && last[2].trim().startsWith('[')) return { status: 'ok', json: last[2], block: last[0], fallback: true };
  return { status: 'missing', json: null, block: null, fallback: false };
}

/** Remove trailing commas before `]` / `}` that sit outside of string literals. */
function stripTrailingCommas(text) {
  let out = '';
  let inString = false;
  let escape = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      out += c;
      if (escape) escape = false;
      else if (c === '\\') escape = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
      continue;
    }
    if (c === ',') {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j])) j++;
      if (text[j] === ']' || text[j] === '}') continue;
    }
    out += c;
  }
  return out;
}

function tryParse(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    try {
      return { ok: true, value: JSON.parse(stripTrailingCommas(text)) };
    } catch (e) {
      return { ok: false, error: e };
    }
  }
}

/** Balanced JSON object/array (string-aware) starting exactly at `start`, or null. */
function balancedAt(text, start) {
  const stack = [];
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escape) escape = false;
      else if (c === '\\') escape = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '{' || c === '[') stack.push(c === '{' ? '}' : ']');
    else if (c === '}' || c === ']') {
      if (stack.pop() !== c) return null;
      if (!stack.length) return text.slice(start, i + 1);
    }
  }
  return null;
}

/** Try every balanced `{…}` / `[…]` candidate left to right; return the first that parses. */
function firstParsableCandidate(text) {
  let lastError = null;
  let tries = 0;
  for (let i = 0; i < text.length && tries < 200; i++) {
    if (text[i] !== '{' && text[i] !== '[') continue;
    const cand = balancedAt(text, i);
    if (!cand) continue;
    tries++;
    const r = tryParse(cand);
    if (r.ok && r.value && typeof r.value === 'object') return { ok: true, value: r.value };
    // Balanced but not JSON (e.g. `[cto.1]` in prose): keep scanning.
    lastError = r.error ?? lastError;
  }
  return { ok: false, error: lastError };
}

/**
 * Extract JSON from a model reply: raw JSON, a fenced block (the LAST fence that
 * parses wins, since models often show an example first), or the first balanced
 * object/array that parses amid chatter. Tolerates trailing commas.
 */
export function extractJsonFromText(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    throw new Error('Input text is empty or not a string.');
  }
  const text = (rawText.startsWith(BOM) ? rawText.slice(1) : rawText).trim();

  const direct = tryParse(text);
  if (direct.ok) return direct.value;

  const fenced = [];
  for (const f of text.matchAll(ANY_FENCE_RE)) {
    const inner = f[2].trim();
    const r = tryParse(inner);
    if (r.ok && r.value && typeof r.value === 'object') fenced.push(r.value);
    else {
      const c = firstParsableCandidate(inner);
      if (c.ok) fenced.push(c.value);
    }
  }
  if (fenced.length) return fenced[fenced.length - 1];

  const c = firstParsableCandidate(text);
  if (c.ok) return c.value;
  if (c.error) throw new Error(`找到 JSON 片段但無法解析：${c.error.message}`);
  throw new Error('輸出中找不到 JSON 物件或陣列。');
}

function parseOutput(rawOutput, what) {
  let data;
  try {
    data = typeof rawOutput === 'string' ? extractJsonFromText(rawOutput) : rawOutput;
  } catch (err) {
    return { error: `JSON 解析失敗：${err.message}` };
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { error: `${what}輸出必須是 JSON 物件。` };
  }
  return { data };
}

function checkBrief(brief) {
  if (!brief || !Array.isArray(brief.options) || !Array.isArray(brief.criteria)) {
    throw new Error('brief 必須包含 options 與 criteria 陣列（Phase 6 定案後的準則）。');
  }
}

function checkWeights(data, criteriaIds, errors, warnings) {
  if (!data.weights || typeof data.weights !== 'object' || Array.isArray(data.weights)) {
    errors.push('缺少 `weights` 物件（各準則權重）。');
    return;
  }
  let positive = 0;
  for (const cid of criteriaIds) {
    if (data.weights[cid] === undefined || data.weights[cid] === null) {
      errors.push(`weights 缺少準則：\`${cid}\``);
      continue;
    }
    const w = Number(data.weights[cid]);
    if (!Number.isFinite(w) || w < 0) {
      errors.push(`準則 \`${cid}\` 的權重必須是非負數，收到：${data.weights[cid]}`);
    } else if (w > 0) positive++;
  }
  for (const k of Object.keys(data.weights)) {
    if (!criteriaIds.has(k)) errors.push(`weights 出現未知的準則 ID：\`${k}\``);
  }
  if (positive === 0 && !errors.length) warnings.push('所有權重皆為 0，程式會改用平均權重。');
}

function checkCells(data, optionIds, criteriaIds, errors, warnings, { rationaleField, ledger }) {
  if (!Array.isArray(data.cells)) {
    errors.push('缺少 `cells` 陣列（各方案與準則評分）。');
    return;
  }
  const seen = new Set();
  for (const [idx, cell] of data.cells.entries()) {
    if (!cell || typeof cell !== 'object') {
      errors.push(`cells[${idx}] 不是物件。`);
      continue;
    }
    const oid = cell.option_id;
    const cid = cell.criterion_id;
    if (!oid || !optionIds.has(oid)) errors.push(`cells[${idx}] 的 option_id 無效或不存在於簡報：\`${oid}\``);
    if (!cid || !criteriaIds.has(cid)) errors.push(`cells[${idx}] 的 criterion_id 無效或不存在於簡報：\`${cid}\``);
    const slot = `${oid}|${cid}`;
    if (oid && cid) {
      if (seen.has(slot)) errors.push(`重複評分格子：\`${slot}\``);
      seen.add(slot);
    }
    const score = Number(cell.score);
    if (cell.score === null || cell.score === '' || !Number.isFinite(score) || score < 1 || score > 10) {
      errors.push(`格子 \`${slot}\` 的分數必須在 1 到 10 之間，收到：${cell.score}`);
    }
    const why = cell[rationaleField];
    if (!why || typeof why !== 'string' || !why.trim()) {
      warnings.push(`格子 \`${slot}\` 缺少理由說明 (${rationaleField})。`);
    }
    if (cell.evidence_claim_ids !== undefined && !Array.isArray(cell.evidence_claim_ids)) {
      errors.push(`格子 \`${slot}\` 的 evidence_claim_ids 必須是陣列。`);
    }
    if (Array.isArray(cell.evidence_claim_ids)) {
      // Accept `#vex.1`, `[VEX.1]`, full-width ids; the cleaned output carries the canonical id.
      cell.evidence_claim_ids = cell.evidence_claim_ids.map(normalizeClaimId).filter(Boolean);
    }
    if (ledger?.claims && Array.isArray(cell.evidence_claim_ids)) {
      for (const claimId of cell.evidence_claim_ids) {
        const claim = ledger.claims[claimId];
        if (!claim) errors.push(`格子 \`${slot}\` 引用的證據論點編號不存在於索引：\`${claimId}\``);
        else if (claim.status === 'conceded') errors.push(`格子 \`${slot}\` 引用了已被讓步的論點作為支持證據：\`${claimId}\``);
        else if (claim.status === 'disputed_fact') errors.push(`格子 \`${slot}\` 引用了已被查核判定可能錯誤的論點：\`${claimId}\``);
      }
    }
  }
  for (const oid of optionIds) {
    for (const cid of criteriaIds) {
      if (!seen.has(`${oid}|${cid}`)) errors.push(`缺少評分格子：\`${oid}|${cid}\``);
    }
  }
}

export function validateJudgeOutput(brief, rawOutput, ledger = null) {
  checkBrief(brief);
  const { data, error } = parseOutput(rawOutput, '評審');
  if (error) return { ok: false, errors: [error], warnings: [], data: null };

  const errors = [];
  const warnings = [];
  const optionIds = new Set(brief.options.map((o) => o.id));
  const criteriaIds = new Set(brief.criteria.map((c) => c.id));

  checkWeights(data, criteriaIds, errors, warnings);
  checkCells(data, optionIds, criteriaIds, errors, warnings, { rationaleField: 'rationale', ledger });
  if (data.weights && typeof data.weights === 'object') {
    for (const cid of criteriaIds) {
      if (!data.weight_rationale?.[cid]) warnings.push(`缺少準則 \`${cid}\` 的 weight_rationale。`);
    }
  }
  return { ok: errors.length === 0, errors, warnings, data: errors.length === 0 ? data : null };
}

export function validatePersonaOutput(brief, rawOutput, expectedSpeakerId = null, ledger = null) {
  checkBrief(brief);
  const { data, error } = parseOutput(rawOutput, '辯手評分');
  if (error) return { ok: false, errors: [error], warnings: [], data: null };

  const errors = [];
  const warnings = [];
  if (expectedSpeakerId && canonicalSpeaker(data.speaker_id) !== canonicalSpeaker(expectedSpeakerId)) {
    errors.push(`speaker_id 不符：預期為 \`${expectedSpeakerId}\`，收到 \`${data.speaker_id}\``);
  }
  if (!data.speaker_id) errors.push('缺少 speaker_id。');

  const optionIds = new Set(brief.options.map((o) => o.id));
  const criteriaIds = new Set(brief.criteria.map((c) => c.id));
  if (!data.final_choice || !optionIds.has(data.final_choice)) {
    errors.push(`final_choice 無效或未提供，必須是以下方案之一：${[...optionIds].join(', ')}`);
  }
  checkWeights(data, criteriaIds, errors, warnings);
  checkCells(data, optionIds, criteriaIds, errors, warnings, { rationaleField: 'reason', ledger });
  return { ok: errors.length === 0, errors, warnings, data: errors.length === 0 ? data : null };
}

/** Normalise the documented claim fields and the legacy long names. */
export function normalizeRawClaim(raw) {
  return {
    text: typeof raw?.text === 'string' ? raw.text.trim() : '',
    quote: typeof raw?.quote === 'string' ? raw.quote.trim() : '',
    kind: typeof raw?.kind === 'string' ? raw.kind.trim().toLowerCase() : '',
    supports: [].concat(raw?.supports ?? raw?.supports_option_ids ?? []).filter(Boolean),
    attacks: [].concat(raw?.attacks ?? raw?.attacks_claim_ids ?? []).filter(Boolean).map(normalizeClaimId),
    concedes: [].concat(raw?.concedes ?? raw?.concedes_claim_ids ?? []).filter(Boolean).map(normalizeClaimId),
  };
}

export function validateTurnMarkdown(rawMarkdown, speakerId = null, ledger = null) {
  const errors = [];
  const warnings = [];
  if (!rawMarkdown || typeof rawMarkdown !== 'string' || !rawMarkdown.trim()) {
    return { ok: false, errors: ['發言內容為空。'], warnings: [], claims: [] };
  }

  const found = findClaimsBlock(rawMarkdown);
  let claims = [];
  if (found.status === 'unclosed') {
    errors.push('```claims 區塊沒有結尾的 ```（輸出可能被截斷），請要求辯手重新輸出完整發言。');
  } else if (found.status === 'missing') {
    warnings.push('發言末尾未找到 ```claims JSON 區塊（開場與交叉質詢必須有，ledger 會拒收）。');
  } else {
    if (found.fallback) warnings.push('claims 區塊用了 ```json 圍欄，已接受；請提醒辯手使用 ```claims。');
    try {
      const parsed = extractJsonFromText(found.json);
      if (Array.isArray(parsed)) claims = parsed;
      else if (parsed && Array.isArray(parsed.claims)) claims = parsed.claims;
      else errors.push('```claims 區塊解析後不是陣列格式。');
    } catch (err) {
      errors.push(`\`\`\`claims JSON 區塊解析失敗：${err.message}`);
    }
  }

  const body = found.block ? rawMarkdown.replace(found.block, '') : rawMarkdown;
  const known = ledger?.claims ?? null;
  for (const [idx, raw] of claims.entries()) {
    const c = normalizeRawClaim(raw);
    if (!c.text) errors.push(`claims[${idx}] 缺少 text 描述。`);
    if (!c.kind || !VALID_KINDS.includes(c.kind)) {
      errors.push(`claims[${idx}] 的 kind \`${raw?.kind}\` 無效，只能是：${VALID_KINDS.join(', ')}`);
    }
    if (!c.quote) warnings.push(`claims[${idx}] 缺少 quote（本文中的逐字原文），索引會以 text 代替。`);
    else if (!body.includes(c.quote)) warnings.push(`claims[${idx}] 的 quote 不是發言本文中的逐字原文：「${c.quote}」`);
    for (const ref of [...c.attacks, ...c.concedes]) {
      if (!isClaimId(ref)) errors.push(`claims[${idx}] 引用的編號格式錯誤：\`${ref}\`（應為 前綴.序號，如 cto.3）`);
      else if (known && !known[ref]) warnings.push(`claims[${idx}] 引用的論點編號不存在於索引：\`${ref}\``);
    }
  }

  const refs = parseInTextRefs(rawMarkdown);
  for (const m of refs.malformed) warnings.push(`${m} 沒有可辨識的論點編號，讓步不會生效。`);
  if (known) {
    for (const ref of [...refs.references, ...refs.concessions]) {
      if (!known[ref]) warnings.push(`發言中引用的論點編號不存在於索引中：\`#${ref}\``);
    }
  }

  return { ok: errors.length === 0, errors, warnings, claims, speaker: speakerId ? canonicalSpeaker(speakerId) : null };
}

// ---------------------------------------------------------------------- CLI

const USAGE = [
  '用法：node validate.mjs <judge|persona|turn> …',
  '  node validate.mjs judge  <brief.json> <judge-output> [--ledger state.json] [--write-clean out.json]',
  '  node validate.mjs persona <brief.json> <persona-output> --speaker <id> [--ledger state.json] [--write-clean out.json]',
  '  node validate.mjs turn    <turn.md> [--ledger state.json]',
].join('\n');

async function main() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      ledger: { type: 'string' },
      'write-clean': { type: 'string' },
      speaker: { type: 'string' },
    },
    allowPositionals: true,
  });

  const command = positionals[0];
  if (!command || !['judge', 'persona', 'turn'].includes(command)) throw new UsageError(USAGE);

  const ledger = values.ledger ? readJson(values.ledger, '--ledger') : null;

  let result;
  if (command === 'turn') {
    // Backwards compatible: `turn <brief.json> <turn.md>` still works.
    const turnPath = positionals.length >= 3 ? positionals[2] : positionals[1];
    if (!turnPath) throw new UsageError(USAGE);
    result = validateTurnMarkdown(readText(turnPath), values.speaker ?? null, ledger);
  } else {
    if (!positionals[1] || !positionals[2]) throw new UsageError(USAGE);
    const brief = readJson(positionals[1], 'brief.json');
    const raw = readText(positionals[2]);
    result = command === 'judge'
      ? validateJudgeOutput(brief, raw, ledger)
      : validatePersonaOutput(brief, raw, values.speaker ?? null, ledger);
    if (result.ok && values['write-clean']) {
      writeFileSync(values['write-clean'], JSON.stringify(result.data, null, 2), 'utf8');
    }
  }

  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

if (isMain(import.meta.url)) runCli(main);
