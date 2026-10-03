#!/usr/bin/env node
/**
 * audit.mjs — Deterministic audit engine for debate run deliverables.
 * Inspects quotes against transcript, checks claim id existence and status,
 * validates numbers against analysis, and flags logic violations.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

export function normalizeText(str) {
  if (!str) return '';
  return str
    .replace(/\s+/g, '')
    .replace(/[，。！？；：「」『』、,.!?;:"'—–-]/g, '')
    .toLowerCase();
}

export function auditRunDirectory(runDir) {
  const issues = [];

  const readJsonSafe = (filename) => {
    const p = join(runDir, filename);
    if (!existsSync(p)) return null;
    try {
      return JSON.parse(readFileSync(p, 'utf-8'));
    } catch {
      return null;
    }
  };

  const readTextSafe = (filename) => {
    const p = join(runDir, filename);
    if (!existsSync(p)) return '';
    try {
      return readFileSync(p, 'utf-8');
    } catch {
      return '';
    }
  };

  const state = readJsonSafe('state.json');
  const rawAnalysis = readJsonSafe('analysis.json');
  const input = readJsonSafe('input.json');
  const reportMd = readTextSafe('report.md');
  const transcriptMd = readTextSafe('transcript.md');

  if (!rawAnalysis) {
    issues.push({
      severity: 'high',
      location: 'analysis.json',
      problem: '缺少 analysis.json 檔案。',
      fix: '請先執行 analyze.mjs 產生數學分析結果。',
    });
    return { passed: false, issues };
  }

  const analysis = rawAnalysis.analysis || rawAnalysis;
  const matrix = rawAnalysis.matrix || rawAnalysis.analysis?.matrix || {};
  const extras = input?.extras || {};
  const verdict = extras.verdict || {};

  // 1. Check winner alignment
  const recommended = (verdict.recommended_option_id || '').toLowerCase();
  const mathWinner = (analysis.winner || '').toLowerCase();
  if (recommended && mathWinner && recommended !== mathWinner) {
    issues.push({
      severity: 'high',
      location: 'extras.verdict.recommended_option_id',
      problem: `判決推薦方案 \`${recommended}\` 與數學計算贏家 \`${mathWinner}\` 不一致！`,
      fix: `必須將推薦方案改為數學贏家 \`${mathWinner}\`。`,
    });
  }

  // 2. Check confidence label matches probability
  const winnerProb = analysis.win_probability?.[mathWinner] ?? 0;
  const confidence = verdict.confidence_label || '';
  if (winnerProb >= 0.75 && confidence && !['高', 'high'].includes(confidence.toLowerCase())) {
    issues.push({
      severity: 'medium',
      location: 'extras.verdict.confidence_label',
      problem: `勝率為 ${Math.round(winnerProb * 100)}% (≥75%)，但信心評級為「${confidence}」，預期為「高」。`,
      fix: '將信心評級修改為「高」。',
    });
  } else if (winnerProb < 0.5 && confidence && !['低', 'low'].includes(confidence.toLowerCase())) {
    issues.push({
      severity: 'medium',
      location: 'extras.verdict.confidence_label',
      problem: `勝率為 ${Math.round(winnerProb * 100)}% (<50%)，但信心評級為「${confidence}」，預期為「低」。`,
      fix: '將信心評級修改為「低」。',
    });
  }

  // 3. Margin check
  if (analysis.margin !== undefined && analysis.margin < 0.1) {
    if (!reportMd.includes('過於接近')) {
      issues.push({
        severity: 'medium',
        location: 'report.md',
        problem: `領先幅度 margin (${analysis.margin}) < 0.1，報告內文應明註「過於接近」。`,
        fix: '在報告結論段落加入兩方案「過於接近」的風險警示。',
      });
    }
  }

  // 4. Quote authenticity check in highlights
  const normTranscript = normalizeText(transcriptMd);
  const highlights = extras.highlights || [];
  for (const [idx, hl] of highlights.entries()) {
    if (hl.quote) {
      const normQuote = normalizeText(hl.quote);
      if (normQuote && !normTranscript.includes(normQuote)) {
        issues.push({
          severity: 'high',
          location: `extras.highlights[${idx}].quote`,
          problem: `高光引言「${hl.quote}」並非逐字稿中的連續原文（疑似拼接、改寫或虛構）。`,
          fix: '必須從逐字稿中選取連續的一段原文逐字引用，若有省略應標註「…」。',
        });
      }
    }
  }

  // 5. Evidence validity check
  const knownClaims = state?.claims || {};
  if (input?.chairSamples) {
    for (const [sIdx, sample] of input.chairSamples.entries()) {
      for (const cell of sample.cells || []) {
        for (const cid of cell.evidence_claim_ids || []) {
          const claim = knownClaims[cid];
          if (!claim && Object.keys(knownClaims).length > 0) {
            issues.push({
              severity: 'high',
              location: `input.chairSamples[${sIdx}].cells[${cell.option_id}|${cell.criterion_id}]`,
              problem: `引用了不存在的論點編號：\`#${cid}\``,
              fix: `移除無效引用或替換為正確的論點編號。`,
            });
          } else if (claim) {
            if (claim.status === 'conceded') {
              issues.push({
                severity: 'high',
                location: `input.chairSamples[${sIdx}].cells[${cell.option_id}|${cell.criterion_id}]`,
                problem: `引用了已被讓步的論點作為支持證據：\`#${cid}\``,
                fix: `不可使用已被讓步的論點作為評分依據，請更換證據論點。`,
              });
            } else if (claim.status === 'disputed_fact') {
              issues.push({
                severity: 'high',
                location: `input.chairSamples[${sIdx}].cells[${cell.option_id}|${cell.criterion_id}]`,
                problem: `引用了已被事實查核判定可能錯誤的論點：\`#${cid}\``,
                fix: `更換為合理的事實論點。`,
              });
            }
          }
        }
      }
    }
  }

  // 6. Transcript completeness check
  if (transcriptMd) {
    if (!transcriptMd.includes('### ⚖️ 天秤主席') && !transcriptMd.includes('天秤主席')) {
      issues.push({
        severity: 'medium',
        location: 'transcript.md',
        problem: '逐字稿缺少主席開場白或主席指令。',
        fix: '逐字稿必須完整記錄主席的開場白與每一輪的主持指令。',
      });
    }

    // Check round count in state
    if (state && state.turns) {
      const rounds = new Set(
        state.turns
          .filter((t) => t.round !== null && t.round !== undefined)
          .map((t) => t.round)
      );
      if (rounds.size < 2) {
        issues.push({
          severity: 'medium',
          location: 'state.turns',
          problem: `交叉質詢僅記錄了 ${rounds.size} 輪，規格要求至少進行 2 輪。`,
          fix: '請依規定完整執行第 2 輪交叉質詢。',
        });
      }
    }
  }

  const passed = issues.filter((i) => i.severity === 'high').length === 0;
  return { passed, issues };
}

// CLI Execution
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
  });

  const runDir = positionals[0];
  if (!runDir) {
    console.error('用法：node audit.mjs <run-dir>');
    process.exit(2);
  }

  const result = auditRunDirectory(runDir);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.passed ? 0 : 1);
}
