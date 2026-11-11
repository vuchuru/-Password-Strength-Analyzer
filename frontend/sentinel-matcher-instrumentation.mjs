
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

function stableResult(result) {
  const { calcTime, ...stable } = result;
  return JSON.stringify(stable);
}

function createMetrics() {
  return {
    dictionaryCalls: 0,
    dictionaryTime: 0,
    l33tDictionaryScans: 0,
    wordSequenceDictionaryCalls: 0,
    rangedDictionaryCalls: 0,
    rangedDictionaryTime: 0,
    l33tMatcherCalls: 0,
    l33tMatcherTime: 0,
    duplicateCheckCalls: 0,
    duplicateCheckTime: 0,
    duplicateComparisons: 0,
    callsByClass: {},
  };
}

let metrics = createMetrics();
let insideDuplicateCheck = false;

// Capture uninstrumented results first.
const baselineResults = new Map();

for (const [label, password] of samples) {
  const baseline = engine.check(password);
  baselineResults.set(label, stableResult(baseline));
}

console.log("Uninstrumented baselines captured:", baselineResults.size);

// Safely instrument an actual class prototype.
function instrumentPrototypeMethod(prototype, methodName, onCall) {
  if (!prototype || typeof prototype[methodName] !== "function") {
    throw new Error(
      `Instrumentation failed: method "${methodName}" was not found.`,
    );
  }

  const original = prototype[methodName];

  prototype[methodName] = function (...args) {
    return onCall.call(this, original, args);
  };
}

// Discover the actual matcher collection.
const matcherCollection = engine.matching.matchers;

if (
  !matcherCollection ||
  typeof matcherCollection !== "object" ||
  Array.isArray(matcherCollection)
) {
  throw new Error("Instrumentation failed: invalid matcher collection.");
}

const matcherEntries = Object.entries(matcherCollection);
const matcherInstances = matcherEntries.map(([, matcher]) => matcher);

// Discover dictionary matchers, including word-sequence internals.
const dictionaryMatchers = [];

function addDictionaryMatcher(matcher) {
  if (
    matcher &&
    typeof matcher.getRangedDictionaries === "function" &&
    !dictionaryMatchers.includes(matcher)
  ) {
    dictionaryMatchers.push(matcher);
  }
}

for (const matcher of matcherInstances) {
  addDictionaryMatcher(matcher);
}

const wordSequenceMatcher = matcherCollection.wordSequence;

if (!wordSequenceMatcher) {
  throw new Error("Instrumentation failed: wordSequence matcher not found.");
}

addDictionaryMatcher(wordSequenceMatcher.dictionary);
addDictionaryMatcher(wordSequenceMatcher.dictionaryL33t);
addDictionaryMatcher(wordSequenceMatcher.dictionaryReverse);

const l33tMatchers = dictionaryMatchers.filter(
  (matcher) => typeof matcher.isAlreadyIncluded === "function",
);

const dictionaryMatcher = dictionaryMatchers.find(
  (matcher) => matcher.constructor.name === "MatchDictionary",
);

if (!dictionaryMatcher || l33tMatchers.length === 0) {
  throw new Error("Instrumentation failed: matcher instances not found.");
}

const dictionaryPrototype = Object.getPrototypeOf(dictionaryMatcher);
const l33tPrototype = Object.getPrototypeOf(l33tMatchers[0]);

if (Object.getPrototypeOf(l33tPrototype) !== dictionaryPrototype) {
  throw new Error("Instrumentation failed: unexpected prototype chain.");
}

for (const matcher of l33tMatchers) {
  if (
    Object.getPrototypeOf(Object.getPrototypeOf(matcher)) !==
    dictionaryPrototype
  ) {
    throw new Error("Instrumentation failed: inconsistent L33T prototype.");
  }
}

// Instrument dictionary matching.
instrumentPrototypeMethod(
  dictionaryPrototype,
  "match",
  function (original, args) {
    const start = performance.now();
    const className = this.constructor.name;

    metrics.dictionaryCalls++;
    metrics.callsByClass[className] =
      (metrics.callsByClass[className] ?? 0) + 1;

    if (this.wordSequenceCheck === true) {
      metrics.wordSequenceDictionaryCalls++;
    }

    if (className === "MatchL33t") {
      metrics.l33tDictionaryScans++;
    }

    try {
      return original.apply(this, args);
    } finally {
      metrics.dictionaryTime += performance.now() - start;
    }
  },
);

// Instrument dictionary preparation.
instrumentPrototypeMethod(
  dictionaryPrototype,
  "getRangedDictionaries",
  function (original, args) {
    const start = performance.now();
    metrics.rangedDictionaryCalls++;

    try {
      return original.apply(this, args);
    } finally {
      metrics.rangedDictionaryTime += performance.now() - start;
    }
  },
);

// Instrument total L33T matcher time.
instrumentPrototypeMethod(
  l33tPrototype,
  "match",
  function (original, args) {
    const start = performance.now();
    metrics.l33tMatcherCalls++;

    try {
      return original.apply(this, args);
    } finally {
      metrics.l33tMatcherTime += performance.now() - start;
    }
  },
);

// Instrument Array.some only while isAlreadyIncluded is executing.
// This counts actual callback comparisons, including short-circuit behavior.
const originalSome = Array.prototype.some;

Array.prototype.some = function (callback, thisArg) {
  if (!insideDuplicateCheck) {
    return originalSome.call(this, callback, thisArg);
  }

  const countedCallback = function (...args) {
    metrics.duplicateComparisons++;
    return callback.apply(thisArg, args);
  };

  return originalSome.call(this, countedCallback, thisArg);
};

// Instrument duplicate-check time.
instrumentPrototypeMethod(
  l33tPrototype,
  "isAlreadyIncluded",
  function (original, args) {
    const start = performance.now();

    metrics.duplicateCheckCalls++;
    insideDuplicateCheck = true;

    try {
      return original.apply(this, args);
    } finally {
      insideDuplicateCheck = false;
      metrics.duplicateCheckTime += performance.now() - start;
    }
  },
);

console.log("");
console.log("========================================");
console.log(" SENTINEL DUPLICATE-CHECK PROFILER");
console.log("========================================");

console.log("Engine matcher count:", matcherEntries.length);
console.log("Dictionary matcher instances:", dictionaryMatchers.length);
console.log("L33T matcher instances:", l33tMatchers.length);
console.log("Warm-up runs:", WARMUP_RUNS);
console.log("Measured runs:", BENCHMARK_RUNS);

if (dictionaryMatchers.length !== 6 || l33tMatchers.length !== 2) {
  throw new Error("Unexpected matcher structure. Stop and inspect package.");
}

// Benchmark helpers.
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function format(value) {
  return Number(value).toFixed(3);
}

let integrityFailures = 0;

// Execute benchmark.
for (const [label, password] of samples) {
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new RangeError(`Invalid benchmark sample: ${label}`);
  }

  for (let i = 0; i < WARMUP_RUNS; i++) {
    engine.check(password);
  }

  const totalTimes = [];
  const dictionaryTimes = [];
  const l33tTimes = [];
  const rangedTimes = [];
  const duplicateTimes = [];

  const totals = createMetrics();
  let lastResult;

  for (let i = 0; i < BENCHMARK_RUNS; i++) {
    metrics = createMetrics();

    const start = performance.now();
    lastResult = engine.check(password);
    totalTimes.push(performance.now() - start);

    if (stableResult(lastResult) !== baselineResults.get(label)) {
      integrityFailures++;
      throw new Error(
        `RESULT INTEGRITY FAILED for "${label}" on measured run ${i + 1}.`,
      );
    }

    dictionaryTimes.push(metrics.dictionaryTime);
    l33tTimes.push(metrics.l33tMatcherTime);
    rangedTimes.push(metrics.rangedDictionaryTime);
    duplicateTimes.push(metrics.duplicateCheckTime);

    for (const key of Object.keys(totals)) {
      if (key === "callsByClass") {
        for (const [name, count] of Object.entries(metrics.callsByClass)) {
          totals.callsByClass[name] =
            (totals.callsByClass[name] ?? 0) + count;
        }
      } else {
        totals[key] += metrics[key];
      }
    }
  }

  const perRun = (value) => value / BENCHMARK_RUNS;

  console.log("");
  console.log("----------------------------------------");
  console.log(`PASSWORD TYPE: ${label}`);
  console.log("----------------------------------------");

  console.log(`Password length: ${password.length}`);
  console.log(`Strength score: ${lastResult.score}`);
  console.log(`Result integrity: PASSED`);

  console.log("");
  console.log("MEDIAN EXECUTION TIMES");

  console.log(`Complete analysis: ${format(median(totalTimes))} ms`);
  console.log(`Dictionary matching: ${format(median(dictionaryTimes))} ms`);
  console.log(`L33T matcher total: ${format(median(l33tTimes))} ms`);
  console.log(`Dictionary preparation: ${format(median(rangedTimes))} ms`);
  console.log(`Duplicate-check time: ${format(median(duplicateTimes))} ms`);

  console.log("");
  console.log("AVERAGE WORK PER ANALYSIS");

  console.log(`Dictionary calls: ${format(perRun(totals.dictionaryCalls))}`);
  console.log(`L33T dictionary scans: ${format(perRun(totals.l33tDictionaryScans))}`);
  console.log(`Word-sequence dictionary calls: ${format(perRun(totals.wordSequenceDictionaryCalls))}`);
  console.log(`Dictionary preparation calls: ${format(perRun(totals.rangedDictionaryCalls))}`);
  console.log(`L33T matcher calls: ${format(perRun(totals.l33tMatcherCalls))}`);
  console.log(`Duplicate-check calls: ${format(perRun(totals.duplicateCheckCalls))}`);
  console.log(`Duplicate comparisons: ${format(perRun(totals.duplicateComparisons))}`);

  console.log("");
  console.log("DICTIONARY CALLS BY MATCHER CLASS");

  for (const [name, count] of Object.entries(totals.callsByClass)) {
    console.log(`${name}: ${format(perRun(count))}`);
  }
}

Array.prototype.some = originalSome;

console.log("");
console.log("========================================");
console.log(" PROFILING COMPLETE");
console.log("========================================");

console.log("Result-integrity failures:", integrityFailures);
console.log(
  integrityFailures === 0
    ? "All result-integrity checks passed."
    : "Result-integrity checks failed.",
);
