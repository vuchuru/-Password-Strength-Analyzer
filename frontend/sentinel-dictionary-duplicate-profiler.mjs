
import { performance } from "node:perf_hooks";
import { createHash } from "node:crypto";
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

function createMetrics() {
  return {
    dictionaryCalls: 0,
    dictionaryTime: 0,
    uniqueSearches: 0,
    sameInstanceRepeatedCalls: 0,
    crossInstanceRepeatedCalls: 0,
    equivalentRepeatedResults: 0,
    differingRepeatedResults: 0,
    callsByClass: {},
  };
}

let metrics = createMetrics();

let seenByInstance = new Map();
let seenGlobally = new Map();

const instanceIds = new WeakMap();
let nextInstanceId = 1;

function getInstanceId(instance) {
  if (!instanceIds.has(instance)) {
    instanceIds.set(instance, nextInstanceId++);
  }

  return instanceIds.get(instance);
}

function fingerprint(value) {
  return createHash("sha256")
    .update(value)
    .digest("hex");
}

function instrumentPrototypeMethod(prototype, methodName, onCall) {
  if (!prototype || typeof prototype[methodName] !== "function") {
    throw new Error(`Missing prototype method: ${methodName}`);
  }

  const original = prototype[methodName];

  prototype[methodName] = function (...args) {
    return onCall.call(this, original, args);
  };
}

// Discover the live matcher collection.
const matcherCollection = engine.matching.matchers;

if (
  !matcherCollection ||
  typeof matcherCollection !== "object" ||
  Array.isArray(matcherCollection)
) {
  throw new Error("Invalid matcher collection.");
}

const matcherEntries = Object.entries(matcherCollection);
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

for (const [, matcher] of matcherEntries) {
  addDictionaryMatcher(matcher);
}

const wordSequenceMatcher = matcherCollection.wordSequence;

if (!wordSequenceMatcher) {
  throw new Error("Word-sequence matcher not found.");
}

addDictionaryMatcher(wordSequenceMatcher.dictionary);
addDictionaryMatcher(wordSequenceMatcher.dictionaryL33t);
addDictionaryMatcher(wordSequenceMatcher.dictionaryReverse);

const dictionaryMatcher = dictionaryMatchers.find(
  (matcher) => matcher.constructor.name === "MatchDictionary",
);

if (!dictionaryMatcher || dictionaryMatchers.length !== 6) {
  throw new Error("Unexpected dictionary matcher structure.");
}

const dictionaryPrototype = Object.getPrototypeOf(dictionaryMatcher);

const l33tMatchers = dictionaryMatchers.filter(
  (matcher) => typeof matcher.isAlreadyIncluded === "function",
);

if (l33tMatchers.length !== 2) {
  throw new Error("Unexpected L33T matcher structure.");
}

for (const matcher of l33tMatchers) {
  const parent = Object.getPrototypeOf(
    Object.getPrototypeOf(matcher),
  );

  if (parent !== dictionaryPrototype) {
    throw new Error("Unexpected L33T prototype chain.");
  }
}

// Instrument dictionary matching without changing its output.
instrumentPrototypeMethod(
  dictionaryPrototype,
  "match",
  function (original, args) {
    const start = performance.now();

    const matchOptions = args[0] ?? {};
    const instanceId = getInstanceId(this);
    const matcherClass = this.constructor.name;

    const signature = JSON.stringify({
      matcherClass,
      wordSequenceCheck: this.wordSequenceCheck === true,
      password: matchOptions.password ?? null,
      useLevenshtein: matchOptions.useLevenshtein ?? false,
      userInputsOptions: matchOptions.userInputsOptions ?? null,
    });

    const key = fingerprint(signature);
    const instanceKey = `${instanceId}:${key}`;

    metrics.dictionaryCalls++;

    metrics.callsByClass[matcherClass] =
      (metrics.callsByClass[matcherClass] ?? 0) + 1;

    let repeatType = "new";

    if (seenByInstance.has(instanceKey)) {
      repeatType = "same-instance";
      metrics.sameInstanceRepeatedCalls++;
    } else if (seenGlobally.has(key)) {
      repeatType = "cross-instance";
      metrics.crossInstanceRepeatedCalls++;
    } else {
      metrics.uniqueSearches++;
    }

    try {
      const result = original.apply(this, args);

      const resultSignature = JSON.stringify(result);

      if (repeatType === "same-instance") {
        const previous = seenByInstance.get(instanceKey);

        if (previous === resultSignature) {
          metrics.equivalentRepeatedResults++;
        } else {
          metrics.differingRepeatedResults++;
        }
      } else if (repeatType === "cross-instance") {
        const previous = seenGlobally.get(key);

        if (previous === resultSignature) {
          metrics.equivalentRepeatedResults++;
        } else {
          metrics.differingRepeatedResults++;
        }
      }

      if (!seenByInstance.has(instanceKey)) {
        seenByInstance.set(instanceKey, resultSignature);
      }

      if (!seenGlobally.has(key)) {
        seenGlobally.set(key, resultSignature);
      }

      return result;
    } finally {
      metrics.dictionaryTime += performance.now() - start;
    }
  },
);

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

console.log("========================================");
console.log(" SENTINEL DICTIONARY DUPLICATE PROFILER");
console.log("========================================");

console.log("Engine matcher count:", matcherEntries.length);
console.log("Dictionary matcher instances:", dictionaryMatchers.length);
console.log("L33T matcher instances:", l33tMatchers.length);
console.log("Warm-up runs:", WARMUP_RUNS);
console.log("Measured runs:", BENCHMARK_RUNS);
console.log("Fingerprint: SHA-256");
console.log("Production engine modified: NO");
console.log("Caching enabled: NO");
console.log("");

for (const [label, password] of samples) {
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new RangeError(`Invalid sample: ${label}`);
  }

  for (let i = 0; i < WARMUP_RUNS; i++) {
    engine.check(password);
  }

  const totalTimes = [];
  const dictionaryTimes = [];

  const totals = createMetrics();

  let baselineScore;
  let baselineGuesses;
  let lastResult;

  for (let i = 0; i < BENCHMARK_RUNS; i++) {
    metrics = createMetrics();
    seenByInstance = new Map();
    seenGlobally = new Map();

    const start = performance.now();

    lastResult = engine.check(password);

    totalTimes.push(performance.now() - start);
    dictionaryTimes.push(metrics.dictionaryTime);

    if (i === 0) {
      baselineScore = lastResult.score;
      baselineGuesses = lastResult.guesses;
    } else if (
      lastResult.score !== baselineScore ||
      lastResult.guesses !== baselineGuesses
    ) {
      throw new Error(
        `Non-deterministic analysis detected for ${label}.`,
      );
    }

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

  console.log("----------------------------------------");
  console.log(`PASSWORD TYPE: ${label}`);
  console.log("----------------------------------------");

  console.log(`Password length: ${password.length}`);
  console.log(`Strength score: ${lastResult.score}`);
  console.log(`Guesses: ${lastResult.guesses}`);

  console.log("");
  console.log("MEDIAN EXECUTION TIMES");

  console.log(`Complete analysis: ${format(median(totalTimes))} ms`);
  console.log(`Dictionary matching: ${format(median(dictionaryTimes))} ms`);

  console.log("");
  console.log("AVERAGE DICTIONARY SEARCH BEHAVIOR PER ANALYSIS");

  console.log(`Total dictionary calls: ${format(perRun(totals.dictionaryCalls))}`);
  console.log(`Unique search inputs: ${format(perRun(totals.uniqueSearches))}`);

  console.log(
    `Repeated calls on same instance: ${format(perRun(totals.sameInstanceRepeatedCalls))}`,
  );

  console.log(
    `Repeated calls across instances: ${format(perRun(totals.crossInstanceRepeatedCalls))}`,
  );

  console.log(
    `Repeated calls with equivalent results: ${format(perRun(totals.equivalentRepeatedResults))}`,
  );

  console.log(
    `Repeated calls with differing results: ${format(perRun(totals.differingRepeatedResults))}`,
  );

  console.log("");
  console.log("DICTIONARY CALLS BY MATCHER CLASS");

  for (const [name, count] of Object.entries(totals.callsByClass)) {
    console.log(`${name}: ${format(perRun(count))}`);
  }

  console.log("");
}

console.log("========================================");
console.log(" DUPLICATE PROFILING COMPLETE");
console.log("========================================");
console.log("Production engine modified: NO");
console.log("Caching enabled: NO");
