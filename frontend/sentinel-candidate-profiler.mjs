
import { performance } from "node:perf_hooks";
import { ZxcvbnFactory } from "@zxcvbn-ts/core";

import getCleanPasswords from
  "@zxcvbn-ts/core/dist/matcher/dictionary/variants/matching/unmunger/getCleanPasswords.mjs";

import passwords from "@zxcvbn-ts/language-common/dist/passwords.json.mjs";
import diceware from "@zxcvbn-ts/language-common/dist/diceware.json.mjs";
import adjacencyGraphs from "@zxcvbn-ts/language-common/dist/adjacencyGraphs.json.mjs";

import commonWords from "@zxcvbn-ts/language-en/dist/commonWords.json.mjs";
import firstnames from "@zxcvbn-ts/language-en/dist/firstnames.json.mjs";
import wordSequences from "@zxcvbn-ts/language-en/dist/wordSequences.json.mjs";
import translations from "@zxcvbn-ts/language-en/dist/translations.mjs";

const WARMUP_RUNS = 10;
const BENCHMARK_RUNS = 30;
const MAX_PASSWORD_LENGTH = 256;

const samples = [
  ["Common", "password123"],
  ["Predictable", "Summer2026!"],
  ["Passphrase", "correct-horse-battery-staple"],
  ["Mixed", "SENTINEL-Demo-Password-2026!"],
  ["Random-looking", "x9$Kp2!vQ7#mL5@z"],
  ["Leetspeak basic", "p@ssw0rd"],
  ["Leetspeak mixed", "P@55w0rd!"],
  ["Username", "Adm1n123!"],
  ["Administrator", "Adm1nistrat0r!"],
  ["Security", "S3cur1ty!2026"],
  ["Password", "P@ssw0rd2026!"],
  ["Hacker", "H@ck3r2026!"],
  ["Monkey", "M0nk3y!123"],
  ["Combination", "$3cur1tyP@ss!"],
  ["Multiple substitutions", "P@$$w0rd!2026"],
  ["Uppercase", "P@SSW0RD!"],
];

const dictionary = {
  "passwords-common": passwords,
  "diceware-common": diceware,
  "commonWords-en": commonWords,
  "firstnames-en": firstnames,
  ...wordSequences,
};

const engine = new ZxcvbnFactory({
  dictionary,
  graphs: adjacencyGraphs,
  translations,
  maxLength: MAX_PASSWORD_LENGTH,
});

const maxSubstitutions = engine.options.l33tMaxSubstitutions;
const trieRoot = engine.options.trieNodeRoot;

if (typeof getCleanPasswords !== "function") {
  throw new Error("Candidate generator import is not a function.");
}

if (!trieRoot) {
  throw new Error("Engine substitution trie was not initialized.");
}

if (maxSubstitutions !== 100) {
  throw new Error(
    `Unexpected substitution limit: ${maxSubstitutions}. Expected 100.`,
  );
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function format(value) {
  return Number(value).toFixed(2);
}

function analyzeCandidates(candidates) {
  let fullSubstitutions = 0;
  let partialSubstitutions = 0;
  let totalSubstitutionOperations = 0;
  let maximumOperations = 0;

  for (const candidate of candidates) {
    const operationCount = candidate.changes.length;

    totalSubstitutionOperations += operationCount;

    maximumOperations = Math.max(
      maximumOperations,
      operationCount,
    );

    if (candidate.isFullSubstitution) {
      fullSubstitutions++;
    } else {
      partialSubstitutions++;
    }
  }

  return {
    candidateCount: candidates.length,
    fullSubstitutions,
    partialSubstitutions,
    totalSubstitutionOperations,
    averageOperations:
      candidates.length === 0
        ? 0
        : totalSubstitutionOperations / candidates.length,
    maximumOperations,
  };
}

console.log("========================================");
console.log(" SENTINEL CANDIDATE GENERATION PROFILER");
console.log("========================================");

console.log("Maximum password length:", MAX_PASSWORD_LENGTH);
console.log("L33T substitution limit:", maxSubstitutions);
console.log("Warm-up runs:", WARMUP_RUNS);
console.log("Measured runs:", BENCHMARK_RUNS);
console.log("Candidate generator: getCleanPasswords()");
console.log("Production engine modified: NO");

console.log("");
console.log("Candidate generator verification: PASSED");
console.log("Substitution trie verification: PASSED");
console.log("Production substitution limit verification: PASSED");
console.log("");

for (const [label, password] of samples) {
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new RangeError(`Invalid benchmark sample: ${label}`);
  }

  // Warm up the exact package candidate generator.
  for (let i = 0; i < WARMUP_RUNS; i++) {
    getCleanPasswords(password, maxSubstitutions, trieRoot);
  }

  const generationTimes = [];

  let finalCandidates;
  let finalStats;

  for (let i = 0; i < BENCHMARK_RUNS; i++) {
    const start = performance.now();

    const candidates = getCleanPasswords(
      password,
      maxSubstitutions,
      trieRoot,
    );

    generationTimes.push(performance.now() - start);

    const stats = analyzeCandidates(candidates);

    if (i === 0) {
      finalStats = stats;
    } else if (
      stats.candidateCount !== finalStats.candidateCount ||
      stats.fullSubstitutions !== finalStats.fullSubstitutions ||
      stats.partialSubstitutions !== finalStats.partialSubstitutions ||
      stats.totalSubstitutionOperations !==
        finalStats.totalSubstitutionOperations
    ) {
      throw new Error(
        `Non-deterministic candidate output detected for ${label}.`,
      );
    }

    finalCandidates = candidates;
  }

  // Run the complete engine separately to capture its scoring baseline.
  const fullAnalysisTimes = [];

  let analysisResult;

  for (let i = 0; i < WARMUP_RUNS; i++) {
    engine.check(password);
  }

  for (let i = 0; i < BENCHMARK_RUNS; i++) {
    const start = performance.now();

    analysisResult = engine.check(password);

    fullAnalysisTimes.push(performance.now() - start);
  }

  console.log("----------------------------------------");
  console.log(`PASSWORD TYPE: ${label}`);
  console.log("----------------------------------------");

  console.log(`Password length: ${password.length}`);
  console.log(`Generated candidates: ${finalStats.candidateCount}`);
  console.log(`Full substitutions: ${finalStats.fullSubstitutions}`);
  console.log(`Partial substitutions: ${finalStats.partialSubstitutions}`);

  console.log(
    `Total substitution operations: ${finalStats.totalSubstitutionOperations}`,
  );

  console.log(
    `Average operations per candidate: ${format(finalStats.averageOperations)}`,
  );

  console.log(
    `Maximum operations in one candidate: ${finalStats.maximumOperations}`,
  );

  console.log("");
  console.log("MEDIAN EXECUTION TIMES");

  console.log(
    `Candidate generation: ${format(median(generationTimes))} ms`,
  );

  console.log(
    `Complete password analysis: ${format(median(fullAnalysisTimes))} ms`,
  );

  console.log("");
  console.log("SCORING BASELINE");

  console.log(`Strength score: ${analysisResult.score}`);
  console.log(`Guesses: ${analysisResult.guesses}`);

  console.log("");
}

console.log("========================================");
console.log(" CANDIDATE PROFILING COMPLETE");
console.log("========================================");
console.log("Production engine modified: NO");
console.log("Substitution limit changed: NO");
