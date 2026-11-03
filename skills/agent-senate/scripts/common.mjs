/**
 * common.mjs — Shared helpers for the Agent Senate scripts.
 *
 * Keeps the contracts that several scripts depend on in ONE place:
 * persona ids / claim prefixes, claim-id syntax, in-text reference parsing,
 * confidence bands, verdict/highlight field normalisation and CLI plumbing.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ----------------------------------------------------------------- personas

/** Canonical persona ids, their claim prefixes and display names. */
export const PERSONAS = {
  conservative_cto: { prefix: 'cto', short_name: '陳CTO', emoji: '🛡️', aliases: ['cto', '陳cto', '鐵算盤'] },
  perf_zealot: { prefix: 'vex', short_name: 'Vex', emoji: '⚡', aliases: ['vex', '極速狂'] },
  kiss_hacker: { prefix: 'kiss', short_name: '剃刀', emoji: '🪓', aliases: ['kiss', '剃刀', 'occam'] },
  security_paranoid: { prefix: 'sec', short_name: '資安官', emoji: '🔐', aliases: ['sec', '資安官'] },
  product_pm: { prefix: 'pm', short_name: '產品PM', emoji: '💼', aliases: ['pm', '產品pm', '產品派'] },
};

const ALIAS_TO_ID = {};
for (const [id, p] of Object.entries(PERSONAS)) {
  ALIAS_TO_ID[id] = id;
  for (const a of p.aliases) ALIAS_TO_ID[a.toLowerCase()] = id;
}

/** Map any known alias (`cto`, `陳CTO`, `conservative_cto`) to the canonical persona id. */
export function canonicalSpeaker(speaker) {
  const s = String(speaker ?? '').trim();
  if (!s) return 'unknown';
  return ALIAS_TO_ID[s.toLowerCase()] ?? s;
}

export function speakerPrefix(speaker) {
  const id = canonicalSpeaker(speaker);
  if (PERSONAS[id]) return PERSONAS[id].prefix;
  // Unknown persona: derive a stable lowercase prefix from the id itself.
  const derived = id.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 6);
  return derived || 'x';
}

// ---------------------------------------------------------------- claim ids

/** Claim ids look like `cto.3`: lowercase prefix, a dot, a positive integer. */
export const CLAIM_ID_SOURCE = '[A-Za-z][A-Za-z0-9_]*\\.\\d+';
export const CLAIM_ID_RE = new RegExp(`^${CLAIM_ID_SOURCE}$`);

export function isClaimId(id) {
  return typeof id === 'string' && CLAIM_ID_RE.test(id.trim());
}

const BRACKET_RE = /【([^【】\n]{1,80})】/g;
const CONCESSION_RE = new RegExp(`^\\s*讓步\\s*[:：]?\\s*((?:#?\\s*${CLAIM_ID_SOURCE}\\s*[,，、]?\\s*)+)$`);
const TRAILING_ID_RE = new RegExp(`(?:^|[\\s#：:])#?(${CLAIM_ID_SOURCE})\\s*$`);
const ANY_ID_RE = new RegExp(CLAIM_ID_SOURCE, 'g');

/**
 * Parse in-text references in a debater turn.
 *  - `【讓步 #cto.1】`            → concession of cto.1
 *  - `> 【陳CTO #cto.1】原話…`     → quote/attack reference to cto.1
 * Anything else in 【】 (e.g. `【重點】`, `【Rust】`) is ignored.
 */
export function parseInTextRefs(text) {
  const concessions = [];
  const references = [];
  for (const m of String(text ?? '').matchAll(BRACKET_RE)) {
    const inner = m[1];
    const c = CONCESSION_RE.exec(inner);
    if (c) {
      for (const id of c[1].match(ANY_ID_RE) ?? []) concessions.push(id.toLowerCase());
      continue;
    }
    const r = TRAILING_ID_RE.exec(inner);
    if (r) references.push(r[1].toLowerCase());
  }
  return { concessions: [...new Set(concessions)], references: [...new Set(references)] };
}

/** True when the text contains at least one `【簡稱 #id】` quote-reference (concessions excluded). */
export function hasQuoteReference(text) {
  return parseInTextRefs(text).references.length > 0;
}

// --------------------------------------------------------------- confidence

/** SKILL.md rule: ≥75% 高, 50–75% 中, <50% 低. */
export function confidenceLabel(probability) {
  const p = Number(probability) || 0;
  if (p >= 0.75) return '高';
  if (p >= 0.5) return '中';
  return '低';
}

const CONFIDENCE_ALIASES = { 高: '高', high: '高', 中: '中', medium: '中', mid: '中', 低: '低', low: '低' };

export function normalizeConfidence(label) {
  if (label === null || label === undefined) return '';
  return CONFIDENCE_ALIASES[String(label).trim().toLowerCase()] ?? String(label).trim();
}

/**
 * Accept the documented verdict schema plus the field names models tend to
 * invent (`winner`, `confidence`, `text`), so reports never silently drop them.
 */
export function normalizeVerdict(v = {}) {
  const verdict = v && typeof v === 'object' ? v : {};
  return {
    recommended_option_id: verdict.recommended_option_id ?? verdict.winner ?? verdict.option_id ?? '',
    confidence_label: normalizeConfidence(verdict.confidence_label ?? verdict.confidence),
    one_liner: verdict.one_liner ?? '',
    recommendation_text: verdict.recommendation_text ?? verdict.text ?? '',
    main_cost: verdict.main_cost ?? '',
    conditions_to_flip: Array.isArray(verdict.conditions_to_flip) ? verdict.conditions_to_flip : [],
  };
}

export function normalizeHighlight(h = {}) {
  return {
    title: h.title ?? '',
    speaker_id: h.speaker_id ?? h.speaker ?? '',
    quote: h.quote ?? '',
    why: h.why ?? h.comment ?? h.reason ?? '',
  };
}

/**
 * report.mjs historically received `input.json` while expecting the bare
 * extras object. Accept both: `{extras:{…}}` (input.json) or `{verdict:…}`.
 */
export function extractExtras(obj) {
  if (!obj || typeof obj !== 'object') return {};
  // An extras object never has its own `extras` key, so its presence means input.json.
  if (obj.extras && typeof obj.extras === 'object') return obj.extras;
  return obj;
}

// ---------------------------------------------------------------------- CLI

export class UsageError extends Error {}

export function stripBom(text) {
  return String(text).replace(/^﻿/, '');
}

export function readText(path, label = path) {
  if (!path) throw new UsageError(`缺少檔案路徑：${label}`);
  if (!existsSync(path)) throw new Error(`找不到檔案：${path}`);
  return stripBom(readFileSync(path, 'utf8'));
}

export function readJson(path, label = path) {
  const text = readText(path, label);
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`無法解析 JSON（${path}）：${e.message}`);
  }
}

export function isMain(importMetaUrl) {
  if (!process.argv[1]) return false;
  try {
    return resolve(process.argv[1]) === fileURLToPath(importMetaUrl);
  } catch {
    return false;
  }
}

/** Run a CLI entrypoint: usage errors exit 2, other errors exit 1, never a raw stack trace. */
export async function runCli(main) {
  try {
    await main();
  } catch (e) {
    if (e instanceof UsageError) {
      console.error(e.message);
      process.exit(2);
    }
    console.error(`錯誤：${e?.message ?? e}`);
    process.exit(1);
  }
}
