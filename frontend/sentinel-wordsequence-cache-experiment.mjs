import { performance } from "node:perf_hooks";
import { isDeepStrictEqual } from "node:util";
import { ZxcvbnFactory } from "@zxcvbn-ts/core";

import passwords from "@zxcvbn-ts/language-common/dist/passwords.json.mjs";
import diceware from "@zxcvbn-ts/language-common/dist/diceware.json.mjs";
import graphs from "@zxcvbn-ts/language-common/dist/adjacencyGraphs.json.mjs";

import commonWords from "@zxcvbn-ts/language-en/dist/commonWords.json.mjs";
import firstnames from "@zxcvbn-ts/language-en/dist/firstnames.json.mjs";
import wordSequences from "@zxcvbn-ts/language-en/dist/wordSequences.json.mjs";
import translations from "@zxcvbn-ts/language-en/dist/translations.mjs";

const WARMUP_RUNS = 10;
const BENCHMARK_RUNS = 50;

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

function createEngine() {
  return new ZxcvbnFactory({
    dictionary: {
      "passwords-common": passwords,
      "diceware-common": diceware,
      "commonWords-en": commonWords,
      "firstnames-en": firstnames,
      ...wordSequences,
    },
    graphs,
    translations,
    maxLength: 256,
    l33tMaxSubstitutions: 100,
  });
}

function installWordSequenceCache(engine) {
  const wordSequenceMatchers = Object.entries(
    engine.matching.matchers.wordSequence,
  ).filter(
    ([name, matcher]) =>
      name !== "options" &&
      matcher.wordSequenceCheck === true &&
      typeof matcher.getRangedDictionaries === "function",
  );

  if (wordSequenceMatchers.length !== 3) {
    throw new Error(
      `Expected 3 word-sequence matchers, found ${wordSequenceMatchers.length}.`,
    );
  }

  const cachedNames = [];

  for (const [name, matcher] of wordSequenceMatchers) {
    // Build the exact objects returned by the original implementation.
    const cachedDictionaries = matcher.getRangedDictionaries();

    if (
      Object.keys(cachedDictionaries.rankedDictionaries).length !== 14
    ) {
      throw new Error(
        `${name}: Expected 14 word-sequence dictionaries.`,
      );
    }

    // The word-sequence branch ignores userInputsOptions.
    // Reuse its original result without changing dictionary contents.
    matcher.getRangedDictionaries = function () {
      return cachedDictionaries;
    };

    cachedNames.push(name);
  }

  return cachedNames;
}

function stableResult(result) {
  const { calcTime, ...stable } = result;
  return stable;
}

function getMedian(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function measure(engine, password) {
  const start = performance.now();
  engine.check(password);
  return performance.now() - start;
}

const baseline = createEngine();
const cached = createEngine();

const cachedMatchers = installWordSequenceCache(cached);

console.log("\n========================================");
console.log(" SENTINEL WORD-SEQUENCE CACHE EXPERIMENT");
console.log("========================================");

console.log("Baseline engine: original implementation");
console.log("Cached engine: filtered dictionaries reused");
console.log("Cached matchers:", cachedMatchers.join(", "));
console.log("Warm-up runs:", WARMUP_RUNS);
console.log("Measured runs:", BENCHMARK_RUNS);
console.log("Test scenarios:", samples.length);

// PHASE 1: Verify complete analysis-result equality.
console.log("\nPHASE 1: RESULT INTEGRITY");
console.log("========================");

let integrityPassed = true;

for (const [label, password] of samples) {
  const baselineResult = stableResult(baseline.check(password));
  const cachedResult = stableResult(cached.check(password));

  if (!isDeepStrictEqual(baselineResult, cachedResult)) {
    integrityPassed = false;
    console.error(`FAIL: ${label}`);
    console.error("Baseline:", JSON.stringify(baselineResult));
    console.error("Cached:  ", JSON.stringify(cachedResult));
  } else {
    console.log(`PASS: ${label}`);
  }
}

if (!integrityPassed) {
  throw new Error(
    "Result integrity failed. Performance comparison aborted.",
  );
}

console.log("\nAll 16 scenarios produced identical stable results.");

// PHASE 2: Warm up both engines.
console.log("\nPHASE 2: WARM-UP");
console.log("================");

for (const [, password] of samples) {
  for (let i = 0; i < WARMUP_RUNS; i++) {
    if (i % 2 === 0) {
      baseline.check(password);
      cached.check(password);
    } else {
      cached.check(password);
      baseline.check(password);
    }
  }
}

console.log("Warm-up completed.");

// PHASE 3: Paired benchmark.
console.log("\nPHASE 3: PERFORMANCE BENCHMARK");
console.log("==============================");

const results = [];

for (const [label, password] of samples) {
  const baselineTimes = [];
  const cachedTimes = [];

  for (let i = 0; i < BENCHMARK_RUNS; i++) {
    // Alternate execution order to reduce order bias.
    if (i % 2 === 0) {
      baselineTimes.push(measure(baseline, password));
      cachedTimes.push(measure(cached, password));
    } else {
      cachedTimes.push(measure(cached, password));
      baselineTimes.push(measure(baseline, password));
    }
  }

  const baselineMedian = getMedian(baselineTimes);
  const cachedMedian = getMedian(cachedTimes);

  const improvement =
    ((baselineMedian - cachedMedian) / baselineMedian) * 100;

  results.push({
    label,
    baselineMedian,
    cachedMedian,
    improvement,
  });

  console.log(`\n${label}`);
  console.log("Baseline median:", baselineMedian.toFixed(3), "ms");
  console.log("Cached median:  ", cachedMedian.toFixed(3), "ms");
  console.log(
    "Change:         ",
    `${improvement >= 0 ? "+" : ""}${improvement.toFixed(2)}%`,
    improvement >= 0 ? "(faster)" : "(slower)",
  );
}

// PHASE 4: Aggregate comparison.
const baselineTotal = results.reduce(
  (sum, item) => sum + item.baselineMedian,
  0,
);

const cachedTotal = results.reduce(
  (sum, item) => sum + item.cachedMedian,
  0,
);

const aggregateImprovement =
  ((baselineTotal - cachedTotal) / baselineTotal) * 100;

console.log("\n========================================");
console.log(" FINAL EXPERIMENT SUMMARY");
console.log("========================================");

console.log("Result integrity: PASS");
console.log("Scenarios tested:", results.length);
console.log("Runs per engine per scenario:", BENCHMARK_RUNS);
console.log("Sum of baseline medians:", baselineTotal.toFixed(3), "ms");
console.log("Sum of cached medians:  ", cachedTotal.toFixed(3), "ms");

console.log(
  "Aggregate change:",
  `${aggregateImprovement >= 0 ? "+" : ""}${aggregateImprovement.toFixed(2)}%`,
);

console.log("\nNo production files were modified.");
console.log("========================================");
