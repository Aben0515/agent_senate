#!/usr/bin/env node
/**
 * validate.mjs — Deterministic validation for subagent outputs:
 * - judge: validates neutral judge scoring JSON
 * - persona: validates debater scoring JSON
 * - turn: validates debater speech markdown and claims block
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

export function extractJsonFromText(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    throw new Error('Input text is empty or not a string.');
  }

  let text = rawText.trim();

  // 1. Direct parse
  try {
    return JSON.parse(text);
  } catch {}

  // 2. Strip code fences ```json ... ```
  const fenceRegex = /```(?:json)?\s*([\s\S]*?)\s*```/i;
  const match = fenceRegex.exec(text);
  if (match) {
    try {
      return JSON.parse(match[1].trim());
    } catch {
      text = match[1].trim();
    }
  }

  // 3. Find first balanced { ... }
  const start = text.indexOf('{');
  if (start !== -1) {
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = start; i < text.length; i++) {
      const c = text[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (c === '\\') {
        escape = true;
        continue;
      }
      if (c === '"') {
        inString = !inString;
        continue;
      }
      if (!inString) {
        if (c === '{') depth++;
        else if (c === '}') {
          depth--;
          if (depth === 0) {
            const candidate = text.slice(start, i + 1);
            try {
              return JSON.parse(candidate);
            } catch {
              // Try removing trailing commas
              const cleaned = candidate.replace(/,\s*([\]}])/g, '$1');
              return JSON.parse(cleaned);
            }
          }
        }
      }
    }
  }

  // 4. Try removing trailing commas on whole text
  const trailingCleaned = text.replace(/,\s*([\]}])/g, '$1');
  return JSON.parse(trailingCleaned);
}

export function validateJudgeOutput(brief, rawOutput, ledger = null) {
  const errors = [];
  const warnings = [];
  let data = null;

  try {
    data = typeof rawOutput === 'string' ? extractJsonFromText(rawOutput) : rawOutput;
  } catch (err) {
    return { ok: false, errors: [`JSON 解析失敗：${err.message}`], warnings: [], data: null };
  }

  if (!data || typeof data !== 'object') {
    return { ok: false, errors: ['評審輸出必須是 JSON 物件。'], warnings: [], data: null };
  }

  const validOptionIds = new Set(brief.options.map((o) => o.id));
  const validCriteriaIds = new Set(brief.criteria.map((c) => c.id));

  // Check weights
  if (!data.weights || typeof data.weights !== 'object') {
    errors.push('缺少 `weights` 物件（各準則權重）。');
  } else {
    for (const cid of validCriteriaIds) {
      if (data.weights[cid] === undefined) {
        errors.push(`weights 缺少準則：\`${cid}\``);
      } else {
        const w = Number(data.weights[cid]);
        if (isNaN(w) || w < 0) {
          errors.push(`準則 \`${cid}\` 的權重必須是非負數，收到：${data.weights[cid]}`);
        }
      }
    }
    for (const k of Object.keys(data.weights)) {
      if (!validCriteriaIds.has(k)) {
        errors.push(`weights 出現未知的準則 ID：\`${k}\``);
      }
    }
  }

  // Check cells: must have exactly one cell per option x criterion
  if (!Array.isArray(data.cells)) {
    errors.push('缺少 `cells` 陣列（各方案與準則評分）。');
  } else {
    const seenSlots = new Set();
    for (const [idx, cell] of data.cells.entries()) {
      const oid = cell.option_id;
      const cid = cell.criterion_id;

      if (!oid || !validOptionIds.has(oid)) {
        errors.push(`cells[${idx}] 的 option_id 無效或不存在於簡報：\`${oid}\``);
      }
      if (!cid || !validCriteriaIds.has(cid)) {
        errors.push(`cells[${idx}] 的 criterion_id 無效或不存在於簡報：\`${cid}\``);
      }

      if (oid && cid) {
        const slotKey = `${oid}|${cid}`;
        if (seenSlots.has(slotKey)) {
          errors.push(`重複評分格子：\`${slotKey}\``);
        }
        seenSlots.add(slotKey);
      }

      const score = Number(cell.score);
      if (isNaN(score) || score < 1 || score > 10) {
        errors.push(`格子 \`${oid}|${cid}\` 的分數必須在 1 到 10 之間，收到：${cell.score}`);
      }

      if (!cell.rationale || typeof cell.rationale !== 'string' || !cell.rationale.trim()) {
        warnings.push(`格子 \`${oid}|${cid}\` 缺少詳細理由說明 (rationale)。`);
      }

      // Check evidence claim IDs if ledger is available
      if (ledger && Array.isArray(cell.evidence_claim_ids)) {
        for (const claimId of cell.evidence_claim_ids) {
          const claim = ledger.claims ? ledger.claims[claimId] : null;
          if (!claim) {
            errors.push(`格子 \`${oid}|${cid}\` 引用的證據論點編號不存在於索引：\`${claimId}\``);
          } else if (claim.status === 'conceded') {
            errors.push(`格子 \`${oid}|${cid}\` 引用了已被讓步的論點作為支持證據：\`${claimId}\``);
          } else if (claim.status === 'disputed_fact') {
            errors.push(`格子 \`${oid}|${cid}\` 引用了已被查核判定可能錯誤的論點：\`${claimId}\``);
          }
        }
      }
    }

    // Check missing slots
    for (const oid of validOptionIds) {
      for (const cid of validCriteriaIds) {
        const slotKey = `${oid}|${cid}`;
        if (!seenSlots.has(slotKey)) {
          errors.push(`缺少評合格子：\`${slotKey}\``);
        }
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings, data: errors.length === 0 ? data : null };
}

export function validatePersonaOutput(brief, rawOutput, expectedSpeakerId = null, ledger = null) {
  const errors = [];
  const warnings = [];
  let data = null;

  try {
    data = typeof rawOutput === 'string' ? extractJsonFromText(rawOutput) : rawOutput;
  } catch (err) {
    return { ok: false, errors: [`JSON 解析失敗：${err.message}`], warnings: [], data: null };
  }

  if (!data || typeof data !== 'object') {
    return { ok: false, errors: ['辯手評分輸出必須是 JSON 物件。'], warnings: [], data: null };
  }

  if (expectedSpeakerId && data.speaker_id !== expectedSpeakerId) {
    errors.push(`speaker_id 不符：預期為 \`${expectedSpeakerId}\`，收到 \`${data.speaker_id}\``);
  }

  const validOptionIds = new Set(brief.options.map((o) => o.id));
  const validCriteriaIds = new Set(brief.criteria.map((c) => c.id));

  if (!data.final_choice || !validOptionIds.has(data.final_choice)) {
    errors.push(`final_choice 無效或未提供，必須是以下方案之一：${[...validOptionIds].join(', ')}`);
  }

  // Check weights
  if (!data.weights || typeof data.weights !== 'object') {
    errors.push('缺少 `weights` 物件。');
  } else {
    for (const cid of validCriteriaIds) {
      if (data.weights[cid] === undefined) {
        errors.push(`weights 缺少準則：\`${cid}\``);
      }
    }
  }

  // Check cells
  if (!Array.isArray(data.cells)) {
    errors.push('缺少 `cells` 陣列。');
  } else {
    const seenSlots = new Set();
    for (const [idx, cell] of data.cells.entries()) {
      const oid = cell.option_id;
      const cid = cell.criterion_id;

      if (!oid || !validOptionIds.has(oid)) {
        errors.push(`cells[${idx}] 的 option_id 無效：\`${oid}\``);
      }
      if (!cid || !validCriteriaIds.has(cid)) {
        errors.push(`cells[${idx}] 的 criterion_id 無效：\`${cid}\``);
      }

      if (oid && cid) {
        const slotKey = `${oid}|${cid}`;
        if (seenSlots.has(slotKey)) {
          errors.push(`重複評分格子：\`${slotKey}\``);
        }
        seenSlots.add(slotKey);
      }

      const score = Number(cell.score);
      if (isNaN(score) || score < 1 || score > 10) {
        errors.push(`格子 \`${oid}|${cid}\` 的分數必須在 1 到 10 之間，收到：${cell.score}`);
      }
    }

    for (const oid of validOptionIds) {
      for (const cid of validCriteriaIds) {
        const slotKey = `${oid}|${cid}`;
        if (!seenSlots.has(slotKey)) {
          errors.push(`缺少評合格子：\`${slotKey}\``);
        }
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings, data: errors.length === 0 ? data : null };
}

export function validateTurnMarkdown(rawMarkdown, speakerId = null, ledger = null) {
  const errors = [];
  const warnings = [];

  if (!rawMarkdown || typeof rawMarkdown !== 'string' || !rawMarkdown.trim()) {
    return { ok: false, errors: ['發言內容為空。'], warnings: [], claims: [] };
  }

  // Extract claims block ```claims [ ... ] ```
  const claimsBlockRegex = /```claims\s*([\s\S]*?)\s*```/i;
  const match = claimsBlockRegex.exec(rawMarkdown);
  let claims = [];

  if (!match) {
    warnings.push('發言末尾未找到 ```claims JSON 區塊。');
  } else {
    try {
      const parsed = extractJsonFromText(match[1]);
      if (Array.isArray(parsed)) {
        claims = parsed;
      } else if (parsed && Array.isArray(parsed.claims)) {
        claims = parsed.claims;
      } else {
        errors.push('```claims 區塊解析後不是陣列格式。');
      }
    } catch (err) {
      errors.push(`\`\`\`claims JSON 區塊解析失敗：${err.message}`);
    }
  }

  const validKinds = new Set(['fact', 'estimate', 'value', 'prediction', 'proposal']);
  for (const [idx, c] of claims.entries()) {
    if (!c.text || typeof c.text !== 'string') {
      errors.push(`claims[${idx}] 缺少 text 描述。`);
    }
    if (!c.quote || typeof c.quote !== 'string') {
      errors.push(`claims[${idx}] 缺少 quote 原文摘錄。`);
    }
    if (!c.kind || !validKinds.has(c.kind)) {
      errors.push(`claims[${idx}] 的 kind \`${c.kind}\` 無效，只能是：${[...validKinds].join(', ')}`);
    }
  }

  // Check quotes in text
  const quoteRefRegex = />?\s*【(?:.+?)\s*#?([a-zA-Z0-9_.-]+)】/g;
  let qMatch;
  while ((qMatch = quoteRefRegex.exec(rawMarkdown)) !== null) {
    const refId = qMatch[1];
    if (ledger && ledger.claims && !ledger.claims[refId]) {
      warnings.push(`發言中引用的論點編號不存在於索引中：\`#${refId}\``);
    }
  }

  return { ok: errors.length === 0, errors, warnings, claims };
}

// CLI Execution
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
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
  if (!command || !['judge', 'persona', 'turn'].includes(command)) {
    console.error('用法：node validate.mjs <judge|persona|turn> <brief.json> <output.json> [--ledger <ledger.json>]');
    process.exit(2);
  }

  let ledger = null;
  if (values.ledger) {
    try {
      ledger = JSON.parse(readFileSync(values.ledger, 'utf-8'));
    } catch (e) {
      console.error(`無法讀取 ledger: ${e.message}`);
    }
  }

  let result = null;
  if (command === 'judge') {
    const brief = JSON.parse(readFileSync(positionals[1], 'utf-8'));
    const judgeRaw = readFileSync(positionals[2], 'utf-8');
    result = validateJudgeOutput(brief, judgeRaw, ledger);
  } else if (command === 'persona') {
    const brief = JSON.parse(readFileSync(positionals[1], 'utf-8'));
    const personaRaw = readFileSync(positionals[2], 'utf-8');
    result = validatePersonaOutput(brief, personaRaw, values.speaker, ledger);
  } else if (command === 'turn') {
    const turnRaw = readFileSync(positionals[2], 'utf-8');
    result = validateTurnMarkdown(turnRaw, values.speaker, ledger);
  }

  if (result.ok && values['write-clean'] && result.data) {
    writeFileSync(values['write-clean'], JSON.stringify(result.data, null, 2), 'utf-8');
  }

  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}
