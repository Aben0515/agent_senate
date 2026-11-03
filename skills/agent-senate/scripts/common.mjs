/**
 * common.mjs — Shared helpers for the Agent Senate scripts.
 *
 * Keeps the contracts that several scripts depend on in ONE place:
 * persona ids / claim prefixes, claim-id syntax, in-text reference parsing,
 * confidence bands, verdict/highlight field normalisation and CLI plumbing.
 */

import { readFileSync, existsSync, realpathSync } from 'node:fs';
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

/**
 * Normalise a claim id as written by a model or a human: full-width → ASCII
 * (NFKC), strip `#`, brackets and whitespace, lowercase. `#ＶＥＸ.1` → `vex.1`.
 */
export function normalizeClaimId(id) {
  return String(id ?? '')
    .normalize('NFKC')
    .trim()
    .replace(/^[\s#\[【(（「]+|[\s\]】)）」]+$/g, '')
    .replace(/^#/, '')
    .toLowerCase();
}

const BRACKET_RE = /【([^【】\n]{1,120})】/g;
// An id inside a bracket: not glued to a preceding letter/digit (so `Rust1.2` is not an id).
const ID_IN_TEXT_RE = new RegExp(`(?<![A-Za-z0-9_.])(${CLAIM_ID_SOURCE})(?![A-Za-z0-9_])`, 'g');

/**
 * Parse in-text references in a debater turn (full-width characters are folded first).
 *  - `【讓步 #cto.1】`, `【讓步 ＃cto.1：理由】`, `【讓步 #cto.1 與 #cto.2】` → concessions
 *  - `> 【陳CTO #cto.1】原話…`, `【Vex #vex.1、#vex.2】`                     → quote/attack references
 * Brackets without a claim id (`【重點】`, `【Rust】`) are ignored. A `【讓步…】`
 * bracket without any id is reported in `malformed` so the caller can warn.
 */
export function parseInTextRefs(text) {
  const concessions = [];
  const references = [];
  const malformed = [];
  for (const m of String(text ?? '').matchAll(BRACKET_RE)) {
    const inner = m[1].normalize('NFKC');
    const ids = [...inner.matchAll(ID_IN_TEXT_RE)].map((x) => x[1].toLowerCase());
    if (/^\s*讓步/.test(inner)) {
      if (ids.length) concessions.push(...ids);
      else malformed.push(m[0]);
      continue;
    }
    references.push(...ids);
  }
  return { concessions: [...new Set(concessions)], references: [...new Set(references)], malformed };
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
/** Render any LLM-provided value as display text (strings pass through; objects never become `[object Object]`). */
export function toText(x) {
  if (x === null || x === undefined) return '';
  if (typeof x === 'string') return x;
  if (typeof x !== 'object') return String(x);
  if (x.criterion_id && x.threshold !== undefined && x.new_winner) {
    const up = x.direction === 'increase';
    return `若「${x.criterion_label ?? x.criterion_id}」權重${up ? '提高' : '降低'}到 ${Math.round(x.threshold * 100)}% ${up ? '以上' : '以下'}，改選 ${x.new_winner}`;
  }
  for (const k of ['text', 'description', 'condition', 'content', 'markdown']) if (typeof x[k] === 'string') return x[k];
  return JSON.stringify(x);
}

export function normalizeVerdict(v = {}) {
  const verdict = v && typeof v === 'object' ? v : {};
  return {
    recommended_option_id: verdict.recommended_option_id ?? verdict.winner ?? verdict.option_id ?? '',
    confidence_label: normalizeConfidence(verdict.confidence_label ?? verdict.confidence),
    one_liner: toText(verdict.one_liner),
    recommendation_text: toText(verdict.recommendation_text ?? verdict.text),
    main_cost: toText(verdict.main_cost),
    conditions_to_flip: [].concat(verdict.conditions_to_flip ?? []).map(toText).filter(Boolean),
  };
}

export function normalizeHighlight(h = {}) {
  return {
    title: toText(h.title),
    speaker_id: h.speaker_id ?? h.speaker ?? '',
    quote: toText(h.quote),
    why: toText(h.why ?? h.comment ?? h.reason),
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

const BOM = String.fromCharCode(0xfeff);

export function stripBom(text) {
  const t = String(text);
  return t.startsWith(BOM) ? t.slice(1) : t;
}

/**
 * Decode a text file written by any common Windows tool: UTF-8 (with/without BOM)
 * or UTF-16LE/BE (PowerShell 5.1 `>` / `Out-File` default).
 */
export function decodeText(buf) {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le');
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    const swapped = Buffer.from(buf.subarray(2));
    swapped.swap16();
    return swapped.toString('utf16le');
  }
  // BOM-less UTF-16LE: ASCII-heavy text has a NUL in every other byte.
  const sample = buf.subarray(0, Math.min(buf.length, 512));
  let oddNuls = 0;
  for (let i = 1; i < sample.length; i += 2) if (sample[i] === 0) oddNuls++;
  if (sample.length >= 4 && oddNuls >= sample.length / 4) return buf.toString('utf16le');
  return stripBom(buf.toString('utf8'));
}

export function readText(path, label = path) {
  if (!path) throw new UsageError(`缺少檔案路徑：${label}`);
  if (!existsSync(path)) throw new Error(`找不到檔案：${path}`);
  return decodeText(readFileSync(path));
}

export function readJson(path, label = path) {
  const text = readText(path, label);
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`無法解析 JSON（${path}）：${e.message}`);
  }
}

/**
 * True when this module is the script node was asked to run. Compares REAL paths:
 * node resolves symlinks/junctions for import.meta.url but not for argv[1], so a
 * `link:` install would otherwise make every CLI silently do nothing.
 */
export function isMain(importMetaUrl) {
  if (!process.argv[1]) return false;
  const real = (p) => {
    try {
      return realpathSync.native(p);
    } catch {
      return resolve(p);
    }
  };
  try {
    let a = real(resolve(process.argv[1]));
    let b = real(fileURLToPath(importMetaUrl));
    if (process.platform === 'win32') {
      a = a.toLowerCase();
      b = b.toLowerCase();
    }
    return a === b;
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
