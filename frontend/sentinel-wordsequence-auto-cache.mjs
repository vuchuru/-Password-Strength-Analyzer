import { performance } from "node:perf_hooks";
import { isDeepStrictEqual } from "node:util";
import assert from "node:assert/strict";
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

function getEnumerableEntries(object) {
  return Object.keys(object).map((key) => [key, object[key]]);
}

function countEnumerableKeys(object) {
  let count = 0;

  for (const key in object) {
    if (Object.hasOwn(object, key)) {
      count++;
    }
  }

  return count;
}

function entriesStillMatch(object, snapshotEntries) {
  if (countEnumerableKeys(object) !== snapshotEntries.length) {
    return false;
  }

  for (const [key, previousValue] of snapshotEntries) {
    if (!Object.hasOwn(object, key)) {
      return false;
    }

    if (!Object.is(object[key], previousValue)) {
      return false;
    }
  }

  return true;
}

function captureConfiguration(options) {
  return {
    optionsRef: options,
    rankedRef: options.rankedDictionaries,
    maxSizesRef: options.rankedDictionariesMaxWordSize,
    namesRef: options.wordSequenceNames,
    isWordSequenceRef: options.isWordSequence,

    names: [...options.wordSequenceNames],

    rankedEntries: getEnumerableEntries(
      options.rankedDictionaries,
    ),

    maxSizeEntries: getEnumerableEntries(
      options.rankedDictionariesMaxWordSize,
    ),
  };
}

function configurationStillMatches(options, snapshot) {
  if (options !== snapshot.optionsRef) return false;

  if (options.rankedDictionaries !== snapshot.rankedRef) {
    return false;
  }

  if (
    options.rankedDictionariesMaxWordSize !== snapshot.maxSizesRef
  ) {
    return false;
  }

  if (options.wordSequenceNames !== snapshot.namesRef) {
    return false;
  }

  if (options.isWordSequence !== snapshot.isWordSequenceRef) {
    return false;
  }

  const currentNames = options.wordSequenceNames;

  if (currentNames.length !== snapshot.names.length) {
    return false;
  }

  for (let i = 0; i < snapshot.names.length; i++) {
    if (currentNames[i] !== snapshot.names[i]) {
      return false;
    }
  }

  if (
    !entriesStillMatch(
      options.rankedDictionaries,
      snapshot.rankedEntries,
    )
  ) {
    return false;
  }

  if (
    !entriesStillMatch(
      options.rankedDictionariesMaxWordSize,
      snapshot.maxSizeEntries,
    )
  ) {
    return false;
  }

  return true;
}

function installAutomaticCache(engine) {
  const matchers = Object.entries(
    engine.matching.matchers.wordSequence,
  )
    .filter(
      ([name, matcher]) =>
        name !== "options" &&
        matcher.wordSequenceCheck === true &&
        typeof matcher.getRangedDictionaries === "function",
    )
    .map(([, matcher]) => matcher);

  if (matchers.length !== 3) {
    throw new Error(
      `Expected 3 word-sequence matchers; found ${matchers.length}.`,
    );
  }

  const options = matchers[0].options;

  if (!matchers.every((matcher) => matcher.options === options)) {
    throw new Error("Word-sequence matchers do not share options.");
  }

  const originalMethods = new Map(
    matchers.map((matcher) => [
      matcher,
      matcher.getRangedDictionaries,
    ]),
  );

  const metrics = {
    hits: 0,
    rebuilds: 0,
  };

  let cachedResult = null;
  let snapshot = null;

  function canShareCache() {
    return matchers.every(
      (matcher) =>
        matcher.options === options &&
        matcher.wordSequenceCheck === true,
    );
  }

  function getSharedResult() {
    if (
      cachedResult !== null &&
      snapshot !== null &&
      configurationStillMatches(options, snapshot)
    ) {
      metrics.hits++;
      return cachedResult;
    }

    // Use the library's original filtering implementation.
    cachedResult = originalMethods.get(matchers[0]).call(matchers[0]);

    snapshot = captureConfiguration(options);
    metrics.rebuilds++;

    return cachedResult;
  }

  for (const matcher of matchers) {
    const original = originalMethods.get(matcher);

    matcher.getRangedDictionaries = function (...args) {
      // Fall back to the original implementation if the three
      // matchers no longer have compatible word-sequence settings.
      if (!canShareCache()) {
        return original.apply(this, args);
      }

      return getSharedResult();
    };
  }

  return {
    matchers,
    metrics,
    getCachedResult: () => getSharedResult(),
  };
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

// --------------------------------------------------
// PHASE 0: CREATE ENGINES AND INSTALL CACHE
// --------------------------------------------------

const baseline = createEngine();
const cached = createEngine();

const cache = installAutomaticCache(cached);

const options =
  cached.matching.matchers.wordSequence.dictionary.options;

const cacheMatcher =
  cached.matching.matchers.wordSequence.dictionary;

console.log("\n========================================");
console.log(" SENTINEL AUTOMATIC CACHE EXPERIMENT");
console.log("========================================");

console.log("Baseline: untouched original engine");
console.log("Cached: automatic invalidation prototype");
console.log("Word-sequence matchers:", cache.matchers.length);
console.log("Warm-up runs:", WARMUP_RUNS);
console.log("Measured runs:", BENCHMARK_RUNS);
console.log("Password scenarios:", samples.length);

// --------------------------------------------------
// PHASE 1: CACHE INVALIDATION TESTS
// --------------------------------------------------

console.log("\nPHASE 1: CACHE INVALIDATION TESTS");
console.log("=================================");

const initial = cacheMatcher.getRangedDictionaries();

assert.equal(
  Object.keys(initial.rankedDictionaries).length,
  14,
);

for (const matcher of cache.matchers) {
  assert.strictEqual(
    matcher.getRangedDictionaries(),
    initial,
    "All three matchers should share the same cached result.",
  );
}
// TEST: Replacing the word-sequence classifier must invalidate the cache.
{
  const originalClassifier = options.isWordSequence;

  try {
    options.isWordSequence = () => false;

    const result = cacheMatcher.getRangedDictionaries();

    assert.equal(
      Object.keys(result.rankedDictionaries).length,
      0,
      "Replacing the classifier should rebuild the filtered dictionaries.",
    );

    console.log("PASS: Classifier replacement invalidates the cache");
  } finally {
    options.isWordSequence = originalClassifier;
    cacheMatcher.getRangedDictionaries();
  }
}
// TEST: One matcher changes its word-sequence mode independently.
{
  const [first, second, third] = cache.matchers;
  const originalFlag = second.wordSequenceCheck;

  second.wordSequenceCheck = false;

  try {
    const firstResult = first.getRangedDictionaries();
    const secondResult = second.getRangedDictionaries();
    const thirdResult = third.getRangedDictionaries();

    assert.notStrictEqual(firstResult, initial);
    assert.notStrictEqual(secondResult, initial);
    assert.notStrictEqual(thirdResult, initial);

    assert.equal(
      Object.keys(secondResult.rankedDictionaries).length,
      Object.keys(options.rankedDictionaries).length,
    );

    console.log("PASS: Independent matcher change triggers original-method fallback");
  } finally {
    second.wordSequenceCheck = originalFlag;
  }

  const restoredFirst = first.getRangedDictionaries();
  const restoredSecond = second.getRangedDictionaries();
  const restoredThird = third.getRangedDictionaries();

  assert.equal(
    Object.keys(restoredFirst.rankedDictionaries).length,
    14,
  );

  assert.strictEqual(restoredFirst, restoredSecond);
  assert.strictEqual(restoredFirst, restoredThird);

  console.log("PASS: Cache safely resumes after matcher compatibility is restored");
}

console.log("PASS: Initial cache contains 14 dictionaries.");
console.log("PASS: All three matchers share one cached result.");

function testRebuild(label, mutate, verify, restore) {
  const previousRebuilds = cache.metrics.rebuilds;

  try {
    mutate();

    const result = cacheMatcher.getRangedDictionaries();

    assert.ok(
      cache.metrics.rebuilds > previousRebuilds,
      `${label}: cache did not rebuild.`,
    );

    verify(result);

    console.log(`PASS: ${label}`);
  } finally {
    restore();

    // Ensure the restored configuration is cached again.
    cacheMatcher.getRangedDictionaries();
  }
}

// TEST 1: Replace rankedDictionaries reference.
{
  const original = options.rankedDictionaries;
  const replacementMonths = {
    ...original["months-en"],
    "__sentinel_cache_probe__": 123,
  };

  testRebuild(
    "Replace rankedDictionaries reference",
    () => {
      options.rankedDictionaries = {
        ...original,
        "months-en": replacementMonths,
      };
    },
    (result) => {
      assert.strictEqual(
        result.rankedDictionaries["months-en"],
        replacementMonths,
      );
    },
    () => {
      options.rankedDictionaries = original;
    },
  );
}

// TEST 2: Replace maximum word-size object.
{
  const original = options.rankedDictionariesMaxWordSize;

  testRebuild(
    "Replace maximum word-size object",
    () => {
      options.rankedDictionariesMaxWordSize = {
        ...original,
        "months-en": 999,
      };
    },
    (result) => {
      assert.equal(
        result.rankedDictionariesMaxWordSize["months-en"],
        999,
      );
    },
    () => {
      options.rankedDictionariesMaxWordSize = original;
    },
  );
}

// TEST 3: Modify wordSequenceNames in place.
{
  const originalNames = [...options.wordSequenceNames];
  const originalRanked = options.rankedDictionaries;
  const originalMaxSizes = options.rankedDictionariesMaxWordSize;

  testRebuild(
    "Modify wordSequenceNames in place",
    () => {
      options.wordSequenceNames.push("customSequence");

      options.rankedDictionaries = {
        ...originalRanked,
        "customSequence-en": {},
      };

      options.rankedDictionariesMaxWordSize = {
        ...originalMaxSizes,
        "customSequence-en": 10,
      };
    },
    (result) => {
      assert.ok(
        "customSequence-en" in result.rankedDictionaries,
      );
    },
    () => {
      options.rankedDictionaries = originalRanked;
      options.rankedDictionariesMaxWordSize = originalMaxSizes;

      options.wordSequenceNames.splice(
        0,
        options.wordSequenceNames.length,
        ...originalNames,
      );
    },
  );
}

// TEST 4: Add and remove dictionary keys in place.
{
  const ranked = options.rankedDictionaries;
  const maxSizes = options.rankedDictionariesMaxWordSize;

  const previousAddRebuilds = cache.metrics.rebuilds;

  ranked["months-custom"] = {};
  maxSizes["months-custom"] = 10;

  const addedResult = cacheMatcher.getRangedDictionaries();

  assert.ok(cache.metrics.rebuilds > previousAddRebuilds);
  assert.ok("months-custom" in addedResult.rankedDictionaries);

  console.log("PASS: Add dictionary keys in place");

  const previousRemoveRebuilds = cache.metrics.rebuilds;

  delete ranked["months-custom"];
  delete maxSizes["months-custom"];

  const removedResult = cacheMatcher.getRangedDictionaries();

  assert.ok(cache.metrics.rebuilds > previousRemoveRebuilds);
  assert.ok(!("months-custom" in removedResult.rankedDictionaries));

  console.log("PASS: Remove dictionary keys in place");
}

// TEST 5: Replace one dictionary value without replacing its container.
{
  const ranked = options.rankedDictionaries;
  const originalMonths = ranked["months-en"];
  const replacementMonths = { ...originalMonths };

  testRebuild(
    "Replace an individual dictionary object",
    () => {
      ranked["months-en"] = replacementMonths;
    },
    (result) => {
      assert.strictEqual(
        result.rankedDictionaries["months-en"],
        replacementMonths,
      );
    },
    () => {
      ranked["months-en"] = originalMonths;
    },
  );
}

// TEST 6: Mutate dictionary contents in place.
// Cached result should see the mutation through its existing reference.
{
  const resultBefore = cacheMatcher.getRangedDictionaries();
  const months = options.rankedDictionaries["months-en"];
  const previousRebuilds = cache.metrics.rebuilds;
  const probe = "__sentinel_in_place_probe__";

  months[probe] = 123456;

  const resultAfter = cacheMatcher.getRangedDictionaries();

  assert.strictEqual(resultAfter, resultBefore);
  assert.equal(
    resultAfter.rankedDictionaries["months-en"][probe],
    123456,
  );
  assert.equal(cache.metrics.rebuilds, previousRebuilds);

  delete months[probe];

  console.log("PASS: In-place dictionary contents remain visible");
}

// TEST 7: Change a maximum word-size value in place.
{
  const maxSizes = options.rankedDictionariesMaxWordSize;
  const originalValue = maxSizes["months-en"];

  testRebuild(
    "Change maximum word-size value in place",
    () => {
      maxSizes["months-en"] = originalValue + 1;
    },
    (result) => {
      assert.equal(
        result.rankedDictionariesMaxWordSize["months-en"],
        originalValue + 1,
      );
    },
    () => {
      maxSizes["months-en"] = originalValue;
    },
  );
}

console.log("\nALL CACHE INVALIDATION TESTS PASSED");

// --------------------------------------------------
// PHASE 2: RESULT INTEGRITY
// --------------------------------------------------

console.log("\nPHASE 2: RESULT INTEGRITY");
console.log("=========================");

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
    "Result integrity failed. Benchmark aborted.",
  );
}

console.log("\nAll 16 scenarios produced identical stable results.");

// --------------------------------------------------
// PHASE 3: WARM-UP
// --------------------------------------------------

console.log("\nPHASE 3: WARM-UP");
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

// --------------------------------------------------
// PHASE 4: PAIRED PERFORMANCE BENCHMARK
// --------------------------------------------------

console.log("\nPHASE 4: PERFORMANCE BENCHMARK");
console.log("==============================");

const results = [];

for (const [label, password] of samples) {
  const baselineTimes = [];
  const cachedTimes = [];

  for (let i = 0; i < BENCHMARK_RUNS; i++) {
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

// --------------------------------------------------
// PHASE 5: AGGREGATE RESULTS
// --------------------------------------------------

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
console.log(" FINAL AUTOMATIC CACHE SUMMARY");
console.log("========================================");

console.log("Cache invalidation tests: PASS");
console.log("Result integrity: PASS");
console.log("Scenarios tested:", results.length);
console.log("Runs per engine per scenario:", BENCHMARK_RUNS);

console.log("Baseline median sum:", baselineTotal.toFixed(3), "ms");
console.log("Cached median sum:  ", cachedTotal.toFixed(3), "ms");

console.log(
  "Aggregate change:",
  `${aggregateImprovement >= 0 ? "+" : ""}${aggregateImprovement.toFixed(2)}%`,
);

console.log("\nCache statistics:");
console.log("Cache hits:", cache.metrics.hits);
console.log("Cache rebuilds:", cache.metrics.rebuilds);

console.log("\nNo production files were modified.");
console.log("========================================");





