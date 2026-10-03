#!/usr/bin/env node
/**
 * quality.mjs — Programmatic quality scoring based on references/quality-rubric.md.
 * Analyzes state.json and transcripts for debate sharpness, politeness leaks,
 * quotation compliance, concession moderation, and factuality.
 */

import { readFileSync, existsSync } from 'node:fs';
import { parseArgs } from 'node:util';

const POLITENESS_PATTERNS = [
  /您說得有道理/i,
  /您說得對/i,
  /我非常同意/i,
  /正如.*?所說/i,
  /不無道理/i,
  /確實很有見地/i,
  /我理解您的觀點/i,
];

export function evaluateDebateQuality(state) {
  const breakdown = {};
  const turns = state.turns || [];
  const debaterTurns = turns.filter((t) => t.type === 'debater');
  const chairTurns = turns.filter((t) => t.type === 'chair');

  // 1. Stance Clarity in Opening (0-2)
  const openingTurns = debaterTurns.filter((t) => t.kind === 'opening');
  let clearOpeningCount = 0;
  for (const t of openingTurns) {
    const firstSentence = t.text.split(/[。！？\n]/)[0] || '';
    if (
      state.brief?.options?.some(
        (o) => firstSentence.toLowerCase().includes(o.id.toLowerCase()) || firstSentence.includes(o.label)
      )
    ) {
      clearOpeningCount++;
    }
  }
  if (openingTurns.length === 0) {
    breakdown.stance_clarity = 0;
  } else if (clearOpeningCount === openingTurns.length) {
    breakdown.stance_clarity = 2;
  } else if (clearOpeningCount > 0) {
    breakdown.stance_clarity = 1;
  } else {
    breakdown.stance_clarity = 0;
  }

  // 2. Concreteness & Numbers (0-2)
  let turnsWithNumbers = 0;
  for (const t of debaterTurns) {
    if (/\d+/.test(t.text)) {
      turnsWithNumbers++;
    }
  }
  const numberRatio = debaterTurns.length ? turnsWithNumbers / debaterTurns.length : 0;
  breakdown.concreteness = numberRatio >= 0.8 ? 2 : numberRatio >= 0.5 ? 1 : 0;

  // 3. Quote Compliance in Rebuttals (0-2)
  const rebuttalTurns = debaterTurns.filter((t) => t.kind === 'rebuttal');
  let quotesCount = 0;
  for (const t of rebuttalTurns) {
    if (/(?:>|\n)\s*【.+?#?[a-zA-Z0-9_.-]+】/.test(t.full_text || t.text)) {
      quotesCount++;
    }
  }
  const quoteRatio = rebuttalTurns.length ? quotesCount / rebuttalTurns.length : 1;
  breakdown.quote_compliance = quoteRatio >= 0.8 ? 2 : quoteRatio >= 0.5 ? 1 : 0;

  // 4. Concessions moderation (0-2)
  // Optimal is 1-3 concessions in a debate. 0 is rigid, >4 is landslide surrender
  const totalConcessions = Object.values(state.claims || {}).filter((c) => c.status === 'conceded').length;
  if (totalConcessions >= 1 && totalConcessions <= 3) {
    breakdown.concessions = 2;
  } else if (totalConcessions === 0 || totalConcessions === 4) {
    breakdown.concessions = 1;
  } else {
    breakdown.concessions = 0;
  }

  // 5. Zero Flattery & Politeness (0-2)
  let politeHits = 0;
  for (const t of debaterTurns) {
    for (const pat of POLITENESS_PATTERNS) {
      if (pat.test(t.text)) {
        politeHits++;
      }
    }
  }
  breakdown.zero_flattery = politeHits === 0 ? 2 : politeHits === 1 ? 1 : 0;

  // 6. Chair Inquiry Sharpness (0-2)
  const directiveTurns = chairTurns.filter((t) => t.kind === 'directive');
  let sharpDirectives = 0;
  for (const dt of directiveTurns) {
    if (/\?|？/.test(dt.text) && (/\d+/.test(dt.text) || /@/.test(dt.text))) {
      sharpDirectives++;
    }
  }
  breakdown.chair_sharpness = directiveTurns.length === 0 ? 1 : sharpDirectives === directiveTurns.length ? 2 : 1;

  // 7. Factuality & No Hallucination (0-2)
  const factChecks = state.fact_checks || [];
  const falseCount = factChecks.filter((fc) => fc.verdict === 'likely_false').length;
  const questCount = factChecks.filter((fc) => fc.verdict === 'questionable').length;
  if (falseCount === 0 && questCount <= 1) {
    breakdown.factuality = 2;
  } else if (falseCount === 0) {
    breakdown.factuality = 1;
  } else {
    breakdown.factuality = 0;
  }

  // 8. Closing Stance Presence (0-2)
  const closingTurns = debaterTurns.filter((t) => t.kind === 'closing');
  breakdown.closing_integrity = closingTurns.length >= 2 ? 2 : closingTurns.length === 1 ? 1 : 0;

  // 9. Novelty / Non-redundancy (0-2)
  const allClaimTexts = Object.values(state.claims || {}).map((c) => c.text);
  const uniqueTexts = new Set(allClaimTexts);
  const redundancyRatio = allClaimTexts.length ? uniqueTexts.size / allClaimTexts.length : 1;
  breakdown.novelty = redundancyRatio >= 0.9 ? 2 : redundancyRatio >= 0.7 ? 1 : 0;

  // 10. Persona Worldview & Terminology (0-2)
  let signatureHits = 0;
  for (const t of debaterTurns) {
    if (/人月|TCO|凌晨三點|p99|GC|延遲|sqlite|剃刀|複雜度|零件/i.test(t.text)) {
      signatureHits++;
    }
  }
  breakdown.persona_consistency = signatureHits >= debaterTurns.length * 0.7 ? 2 : 1;

  const totalScore = Object.values(breakdown).reduce((a, b) => a + b, 0);
  return {
    total_score: totalScore,
    max_score: 20,
    percentage: Math.round((totalScore / 20) * 100),
    passed: totalScore >= 15,
    breakdown,
  };
}

// CLI Execution
if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`) {
  const { positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
  });

  const statePath = positionals[0];
  if (!statePath || !existsSync(statePath)) {
    console.error('用法：node quality.mjs <state.json>');
    process.exit(2);
  }

  const state = JSON.parse(readFileSync(statePath, 'utf-8'));
  const result = evaluateDebateQuality(state);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.passed ? 0 : 1);
}
