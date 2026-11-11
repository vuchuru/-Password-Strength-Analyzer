
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

const dictionary = {
  "passwords-common": passwords,
  "diceware-common": diceware,
  "commonWords-en": commonWords,
  "firstnames-en": firstnames,
  ...wordSequences,
};

function createEngine() {
  return new ZxcvbnFactory({
    dictionary,
    graphs: adjacencyGraphs,
    translations,
    maxLength: MAX_PASSWORD_LENGTH,
    l33tMaxSubstitutions: L33T_LIMIT,
  });
}

// Build a stable signature for word-sequence dictionary configuration.
function getSequenceSignature(options) {
  const ranked = options.rankedDictionaries;
  const names = Object.keys(ranked)
    .filter((name) => options.isWordSequence(name))
    .sort();

  return {
    ranked,
    maxSizes: options.rankedDictionariesMaxWordSize,
    names,
  };
}

// Experimental cache for word-sequence dictionary subsets.
function installSequenceCache(engine) {
  const wordSequenceMatcher =
    engine.matching.matchers.wordSequence;

  const matchers = [
    wordSequenceMatcher.dictionary,
    wordSequenceMatcher.dictionaryL33t,
    wordSequenceMatcher.dictionaryReverse,
  ];

  const caches = matchers.map(() => ({
    ranked: null,
    maxSizes: null,
    names: null,
    dictionaries: null,
    maxWordSizes: null,
  }));

  for (let index = 0; index < matchers.length; index++) {
    const matcher = matchers[index];
    const cache = caches[index];

    // Keep the original method for non-word-sequence matchers.
    const originalGetRangedDictionaries =
      matcher.getRangedDictionaries.bind(matcher);

    matcher.getRangedDictionaries = function (userInputsOptions) {
      // Custom user inputs must retain the package's original merge behavior.
      if (userInputsOptions) {
        return originalGetRangedDictionaries(userInputsOptions);
      }

      const options = this.options;
      const ranked = options.rankedDictionaries;
      const maxSizes = options.rankedDictionariesMaxWordSize;

      const isCacheValid =
        cache.ranked === ranked &&
        cache.maxSizes === maxSizes;

      if (!isCacheValid) {
        const names = Object.keys(ranked).filter((name) =>
          options.isWordSequence(name)
        );

        const dictionaries = {};
        const maxWordSizes = {};

        for (const name of names) {
          dictionaries[name] = ranked[name];
          maxWordSizes[name] = maxSizes[name];
        }

        cache.ranked = ranked;
        cache.maxSizes = maxSizes;
        cache.names = names;
        cache.dictionaries = dictionaries;
        cache.maxWordSizes = maxWordSizes;
      }

      return {
        rankedDictionaries: cache.dictionaries,
        rankedDictionariesMaxWordSize: cache.maxWordSizes,
      };
    };
  }

  return () => caches.map((cache) => ({
    cachedDictionaryCount: cache.names?.length ?? 0,
    initialized: cache.dictionaries !== null,
  }));
}

// Capture the complete matcher output, not only the optimal sequence.
function capture(engine, password) {
  const matches = engine.matching.match(password);

  if (matches instanceof Promise) {
    throw new Error("Unexpected asynchronous matcher.");
  }

  const result = engine.check(password);

  return {
    matches: JSON.parse(JSON.stringify(matches)),
    sequence: JSON.parse(JSON.stringify(result.sequence ?? [])),
    score: result.score,
    guesses: result.guesses,
    crackTimes: JSON.parse(JSON.stringify(result.crackTimes)),
    feedback: JSON.parse(JSON.stringify(result.feedback)),
  };
}

function getMedian(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function benchmark(engine, password) {
  const times = [];

  for (let i = 0; i < WARMUP_RUNS; i++) {
    engine.check(password);
  }

  for (let i = 0; i < BENCHMARK_RUNS; i++) {
    const start = performance.now();
    engine.check(password);
    times.push(performance.now() - start);
  }

  return getMedian(times);
}

function compareExact(original, experimental) {
  return JSON.stringify(original) === JSON.stringify(experimental);
}

function format(value) {
  return `${value.toFixed(2)} ms`;
}

console.log("\n========================================");
console.log(" SENTINEL WORD-SEQUENCE CACHE EXPERIMENT");
console.log("========================================");
console.log("Warm-up runs:", WARMUP_RUNS);
console.log("Measured runs:", BENCHMARK_RUNS);
console.log("Test cases:", samples.length);

const baselineEngine = createEngine();
const experimentalEngine = createEngine();

const cacheStatus = installSequenceCache(experimentalEngine);

let allEquivalent = true;
let totalBaseline = 0;
let totalExperimental = 0;
let improvedCases = 0;

for (const [label, password] of samples) {
  const baselineResult = capture(baselineEngine, password);
  const experimentalResult = capture(experimentalEngine, password);

  const equivalent = compareExact(
    baselineResult,
    experimentalResult
  );

  if (!equivalent) {
    allEquivalent = false;
  }

  // Alternate benchmark order to reduce systematic order bias.
  let baselineMs;
  let experimentalMs;

  if (samples.indexOf(samples.find((item) => item[0] === label)) % 2 === 0) {
    baselineMs = benchmark(baselineEngine, password);
    experimentalMs = benchmark(experimentalEngine, password);
  } else {
    experimentalMs = benchmark(experimentalEngine, password);
    baselineMs = benchmark(baselineEngine, password);
  }

  const difference = baselineMs - experimentalMs;
  const improvement = baselineMs > 0
    ? (difference / baselineMs) * 100
    : 0;

  totalBaseline += baselineMs;
  totalExperimental += experimentalMs;

  if (difference > 0) {
    improvedCases++;
  }

  console.log("\n----------------------------------------");
  console.log("CASE:", label);
  console.log("Exact result equivalence:", equivalent ? "PASS" : "FAIL");
  console.log("Original median:", format(baselineMs));
  console.log("Cached median:", format(experimentalMs));
  console.log("Improvement:", `${improvement.toFixed(2)}%`);

  if (!equivalent) {
    console.log("WARNING: Result mismatch detected.");
    console.log(
      "Original candidate count:",
      baselineResult.matches.length
    );
    console.log(
      "Experimental candidate count:",
      experimentalResult.matches.length
    );
  }
}

const averageBaseline = totalBaseline / samples.length;
const averageExperimental = totalExperimental / samples.length;

console.log("\n========================================");
console.log(" EXPERIMENT SUMMARY");
console.log("========================================");

console.log("All results equivalent:", allEquivalent ? "YES" : "NO");
console.log("Cases faster with cache:", improvedCases, "/", samples.length);
console.log("Average baseline median:", format(averageBaseline));
console.log("Average cached median:", format(averageExperimental));

console.log(
  "Overall improvement:",
  `${((averageBaseline - averageExperimental) / averageBaseline * 100).toFixed(2)}%`
);

console.log("\nCache status:", JSON.stringify(cacheStatus()));

if (allEquivalent) {
  console.log("\nCORRECTNESS: PASS");
} else {
  console.log("\nCORRECTNESS: FAIL");
  process.exitCode = 1;
}

console.log("\n========================================");
console.log(" EXPERIMENT COMPLETE");
console.log("========================================");
