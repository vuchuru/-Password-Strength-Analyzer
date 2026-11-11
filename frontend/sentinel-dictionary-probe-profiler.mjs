
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

// Discover the real matcher collection.
const matcherCollection = engine.matching.matchers;

if (!matcherCollection || typeof matcherCollection !== "object") {
  throw new Error("Could not discover engine matcher collection.");
}

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

for (const matcher of Object.values(matcherCollection)) {
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

if (!dictionaryMatcher) {
  throw new Error("MatchDictionary instance not found.");
}

const dictionaryPrototype = Object.getPrototypeOf(dictionaryMatcher);
const options = dictionaryMatcher.options;

if (!options?.rankedDictionaries) {
  throw new Error("Ranked dictionaries not found.");
}

// Confirm that every matcher uses the same options.
for (const matcher of dictionaryMatchers) {
  if (matcher.options !== options) {
    throw new Error("Matchers do not share the same options object.");
  }
}

// Assign stable IDs to actual matcher instances.
const matcherIds = new Map();

dictionaryMatchers.forEach((matcher, index) => {
  matcherIds.set(matcher, index + 1);
});

// Ignore calcTime because it naturally varies between executions.
// All other result fields must remain identical.
function stableResult(result) {
  const { calcTime, ...analysis } = result;
  return JSON.stringify(analysis);
}

// Save baseline results BEFORE instrumentation.
const baselineResults = new Map();

for (const [label, password] of samples) {
  baselineResults.set(
    label,
    stableResult(engine.check(password)),
  );
}

// Current measurement context.
let activeMatcher = null;
let currentRun = null;

function createRunMetrics() {
  return {
    probes: 0,
    hits: 0,
    uniqueKeys: new Set(),
    byDictionary: new Map(),
    byMatcher: new Map(),
  };
}

function getStats(map, key) {
  if (!map.has(key)) {
    map.set(key, {
      probes: 0,
      hits: 0,
      uniqueKeys: new Set(),
    });
  }

  return map.get(key);
}

// Wrap actual ranked dictionary objects.
// Count string-property reads during MatchDictionary.match().
const rankedDictionaries = options.rankedDictionaries;

for (const [dictionaryName, originalDictionary] of Object.entries(
  rankedDictionaries,
)) {
  rankedDictionaries[dictionaryName] = new Proxy(originalDictionary, {
    get(target, property, receiver) {
      if (
        activeMatcher &&
        currentRun &&
        typeof property === "string"
      ) {
        const context = activeMatcher;
        const value = Reflect.get(target, property, receiver);
        const isHit = value !== undefined;

        currentRun.probes++;

        if (isHit) {
          currentRun.hits++;
        }

        const uniqueKey =
          `${context.id}|${dictionaryName}|${property}`;

        currentRun.uniqueKeys.add(uniqueKey);

        const dictionaryStats = getStats(
          currentRun.byDictionary,
          dictionaryName,
        );

        dictionaryStats.probes++;

        if (isHit) {
          dictionaryStats.hits++;
        }

        dictionaryStats.uniqueKeys.add(property);

        const matcherLabel =
          `${context.id}:${context.className}`;

        const matcherStats = getStats(
          currentRun.byMatcher,
          matcherLabel,
        );

        matcherStats.probes++;

        if (isHit) {
          matcherStats.hits++;
        }

        matcherStats.uniqueKeys.add(
          `${dictionaryName}|${property}`,
        );

        return value;
      }

      return Reflect.get(target, property, receiver);
    },
  });
}

// Instrument the actual dictionary matching prototype.
const originalMatch = dictionaryPrototype.match;

if (typeof originalMatch !== "function") {
  throw new Error("MatchDictionary.match was not found.");
}

dictionaryPrototype.match = function (...args) {
  const previousMatcher = activeMatcher;

  activeMatcher = {
    id: matcherIds.get(this),
    className: this.constructor.name,
  };

  if (!activeMatcher.id) {
    throw new Error("Unknown dictionary matcher instance.");
  }

  try {
    return originalMatch.apply(this, args);
  } finally {
    activeMatcher = previousMatcher;
  }
};

console.log("========================================");
console.log(" SENTINEL DICTIONARY PROBE PROFILER");
console.log("========================================");

console.log("Dictionary matcher instances:", dictionaryMatchers.length);
console.log("Ranked dictionaries:", Object.keys(rankedDictionaries).length);
console.log("Levenshtein enabled:", options.useLevenshteinDistance);
console.log("Warmup runs:", WARMUP_RUNS);
console.log("Measured runs:", BENCHMARK_RUNS);

console.log("");
console.log("Instrumentation attached successfully.");
console.log("Production files modified: NO");
console.log("");

// Run each benchmark sample.
for (const [label, password] of samples) {
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new RangeError(`Invalid sample: ${label}`);
  }

  // Warmup without collecting metrics.
  currentRun = null;

  for (let i = 0; i < WARMUP_RUNS; i++) {
    engine.check(password);
  }

  let totalProbes = 0;
  let totalHits = 0;
  let totalUnique = 0;

  const dictionaryTotals = new Map();
  const matcherTotals = new Map();

  let resultsIdentical = true;

  for (let i = 0; i < BENCHMARK_RUNS; i++) {
    currentRun = createRunMetrics();

    const result = engine.check(password);

    // IMPORTANT: compare stable results, excluding calcTime.
    if (stableResult(result) !== baselineResults.get(label)) {
      resultsIdentical = false;
    }

    totalProbes += currentRun.probes;
    totalHits += currentRun.hits;
    totalUnique += currentRun.uniqueKeys.size;

    for (const [name, stats] of currentRun.byDictionary) {
      const aggregate = getStats(dictionaryTotals, name);

      aggregate.probes += stats.probes;
      aggregate.hits += stats.hits;

      for (const key of stats.uniqueKeys) {
        aggregate.uniqueKeys.add(key);
      }
    }

    for (const [name, stats] of currentRun.byMatcher) {
      const aggregate = getStats(matcherTotals, name);

      aggregate.probes += stats.probes;
      aggregate.hits += stats.hits;

      for (const key of stats.uniqueKeys) {
        aggregate.uniqueKeys.add(key);
      }
    }
  }

  currentRun = null;
  activeMatcher = null;

  const average = (value) => (value / BENCHMARK_RUNS).toFixed(2);

  console.log("----------------------------------------");
  console.log(`PASSWORD TYPE: ${label}`);
  console.log("----------------------------------------");

  console.log(`Password length: ${password.length}`);
  console.log(`Results identical to baseline: ${resultsIdentical}`);

  console.log("");
  console.log("AVERAGE DICTIONARY WORK PER ANALYSIS");

  console.log(`Total property probes: ${average(totalProbes)}`);
  console.log(`Successful probes: ${average(totalHits)}`);
  console.log(`Unique probes: ${average(totalUnique)}`);
  console.log(
    `Repeated probes: ${average(totalProbes - totalUnique)}`,
  );

  console.log("");
  console.log("PROBES BY DICTIONARY");

  for (const [name, stats] of dictionaryTotals) {
    console.log(
      `${name}: ${average(stats.probes)} probes, ` +
      `${average(stats.hits)} hits, ` +
      `${stats.uniqueKeys.size} unique keys across all runs`,
    );
  }

  console.log("");
  console.log("PROBES BY MATCHER INSTANCE");

  for (const [name, stats] of matcherTotals) {
    console.log(
      `${name}: ${average(stats.probes)} probes, ` +
      `${average(stats.hits)} hits`,
    );
  }

  if (!resultsIdentical) {
    console.error(
      "WARNING: Instrumented results differ from baseline!",
    );

    throw new Error(
      `Result integrity check failed for ${label}.`,
    );
  }

  console.log("");
}

console.log("========================================");
console.log(" PROBE PROFILING COMPLETE");
console.log("========================================");
console.log("All result-integrity checks passed.");
