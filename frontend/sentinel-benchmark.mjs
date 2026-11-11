
import { performance } from "node:perf_hooks";
import { ZxcvbnFactory } from "@zxcvbn-ts/core";

import passwords from "@zxcvbn-ts/language-common/dist/passwords.json.mjs";
import diceware from "@zxcvbn-ts/language-common/dist/diceware.json.mjs";
import adjacencyGraphs from "@zxcvbn-ts/language-common/dist/adjacencyGraphs.json.mjs";

import commonWords from "@zxcvbn-ts/language-en/dist/commonWords.json.mjs";
import firstnames from "@zxcvbn-ts/language-en/dist/firstnames.json.mjs";
import wordSequences from "@zxcvbn-ts/language-en/dist/wordSequences.json.mjs";
import translations from "@zxcvbn-ts/language-en/dist/translations.mjs";

const WARMUP_RUNS = 10;
const BENCHMARK_RUNS = 50;
const MAX_PASSWORD_LENGTH = 256;
const L33T_LIMIT = 100;

const samples = [
  ["Common password", "password123"],
  ["Predictable password", "Summer2026!"],
  ["Passphrase", "correct-horse-battery-staple"],
  ["Mixed password", "SENTINEL-Demo-Password-2026!"],
  ["Random-looking password", "x9$Kp2!vQ7#mL5@z"],
  ["Leetspeak basic", "p@ssw0rd"],
  ["Leetspeak mixed", "P@55w0rd!"],
  ["Leetspeak username", "Adm1n123!"],
  ["Leetspeak administrator", "Adm1nistrat0r!"],
  ["Leetspeak security", "S3cur1ty!2026"],
  ["Leetspeak password", "P@ssw0rd2026!"],
  ["Leetspeak hacker", "H@ck3r2026!"],
  ["Leetspeak monkey", "M0nk3y!123"],
  ["Leetspeak combination", "$3cur1tyP@ss!"],
  ["Leetspeak multiple substitutions", "P@$$w0rd!2026"],
  ["Leetspeak uppercase", "P@SSW0RD!"],
];

const engine = new ZxcvbnFactory({
  dictionary: {
    "passwords-common": passwords,
    "diceware-common": diceware,
    "commonWords-en": commonWords,
    "firstnames-en": firstnames,
    ...wordSequences,
  },
  graphs: adjacencyGraphs,
  translations,
  maxLength: MAX_PASSWORD_LENGTH,
  l33tMaxSubstitutions: L33T_LIMIT,
});

const timings = {
  total: [],
  matching: [],
  scoring: [],
  l33t: [],
};

let latestCandidateCount = 0;
let latestMatcherCounts = {};
let latestL33tCandidateCount = 0;

function getMedian(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function getStats(values) {
  if (values.length === 0) {
    return { min: 0, median: 0, average: 0, max: 0 };
  }

  return {
    min: Math.min(...values),
    median: getMedian(values),
    average: values.reduce((sum, value) => sum + value, 0) / values.length,
    max: Math.max(...values),
  };
}

// Capture complete candidate metadata.
function inspectCandidates(result) {
  return JSON.parse(JSON.stringify(result.sequence ?? []));
}

// Instrument complete matching.
const originalMatch = engine.matching.match.bind(engine.matching);

engine.matching.match = (...args) => {
  const start = performance.now();
  const matches = originalMatch(...args);
  const elapsed = performance.now() - start;

  if (matches instanceof Promise) {
    throw new Error("Unexpected asynchronous matcher.");
  }

  timings.matching.push(elapsed);
  latestCandidateCount = matches.length;
  latestMatcherCounts = {};

  for (const match of matches) {
    latestMatcherCounts[match.pattern] =
      (latestMatcherCounts[match.pattern] || 0) + 1;
  }

  return matches;
};

// Instrument scoring.
const originalScoring =
  engine.scoring.mostGuessableMatchSequence.bind(engine.scoring);

engine.scoring.mostGuessableMatchSequence = (...args) => {
  const start = performance.now();
  const result = originalScoring(...args);

  timings.scoring.push(performance.now() - start);

  return result;
};

// Instrument the leetspeak matcher.
// This measures the complete leetspeak matcher duration and its output count.
const l33tMatcher = engine.matching.matchers.dictionaryL33t;
const originalL33tMatch = l33tMatcher.match.bind(l33tMatcher);

l33tMatcher.match = (...args) => {
  const start = performance.now();
  const result = originalL33tMatch(...args);

  timings.l33t.push(performance.now() - start);
  latestL33tCandidateCount = result.length;

  return result;
};

console.log("\n========================================");
console.log("       SENTINEL PERFORMANCE AUDIT");
console.log("========================================");

console.log("Leetspeak substitution limit:", L33T_LIMIT);
console.log("Warm-up runs:", WARMUP_RUNS);
console.log("Measured runs:", BENCHMARK_RUNS);
console.log("Test cases:", samples.length);

for (const [label, password] of samples) {
  // Initial analysis for score and final sequence.
  const result = engine.check(password);
  const optimalMatches = inspectCandidates(result);

  // Warm-up.
  for (let i = 0; i < WARMUP_RUNS; i++) {
    engine.check(password);
  }

  // Clear warm-up measurements.
  for (const values of Object.values(timings)) {
    values.length = 0;
  }

  const totalTimings = [];

  // Benchmark complete analysis.
  for (let i = 0; i < BENCHMARK_RUNS; i++) {
    const start = performance.now();
    engine.check(password);
    totalTimings.push(performance.now() - start);
  }

  const totalStats = getStats(totalTimings);
  const matchingStats = getStats(timings.matching);
  const scoringStats = getStats(timings.scoring);
  const l33tStats = getStats(timings.l33t);

  console.log("\n----------------------------------------");
  console.log(`PASSWORD TYPE: ${label}`);
  console.log("----------------------------------------");

  console.log("Password length:", password.length);
  console.log("Strength score:", result.score);
  console.log("Estimated guesses:", String(result.guesses));

  console.log("\nMATCHING DIAGNOSTICS");
  console.log("Total candidate matches:", latestCandidateCount);
  console.log("Leetspeak candidate matches:", latestL33tCandidateCount);
  console.log("Final optimal matches:", optimalMatches.length);

  for (const [pattern, count] of Object.entries(latestMatcherCounts)) {
    console.log(`  ${pattern}: ${count}`);
  }

  console.log("\nPERFORMANCE BREAKDOWN");

  console.log("Matching median:", matchingStats.median.toFixed(2), "ms");
  console.log("Scoring median:", scoringStats.median.toFixed(2), "ms");
  console.log("Leetspeak matcher median:", l33tStats.median.toFixed(2), "ms");
  console.log("Complete analysis median:", totalStats.median.toFixed(2), "ms");
  console.log("Complete analysis average:", totalStats.average.toFixed(2), "ms");
  console.log("Complete analysis maximum:", totalStats.max.toFixed(2), "ms");
}

console.log("\n========================================");
console.log("       PERFORMANCE AUDIT COMPLETE");
console.log("========================================");
