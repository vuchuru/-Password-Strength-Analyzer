import { ZxcvbnFactory } from "@zxcvbn-ts/core";
import passwords from "@zxcvbn-ts/language-common/dist/passwords.json.mjs";
import diceware from "@zxcvbn-ts/language-common/dist/diceware.json.mjs";
import graphs from "@zxcvbn-ts/language-common/dist/adjacencyGraphs.json.mjs";
import commonWords from "@zxcvbn-ts/language-en/dist/commonWords.json.mjs";
import firstnames from "@zxcvbn-ts/language-en/dist/firstnames.json.mjs";
import wordSequences from "@zxcvbn-ts/language-en/dist/wordSequences.json.mjs";
import translations from "@zxcvbn-ts/language-en/dist/translations.mjs";
import { performance } from "node:perf_hooks";

const dictionary = {
  "passwords-common": passwords,
  "diceware-common": diceware,
  "commonWords-en": commonWords,
  "firstnames-en": firstnames,
  ...wordSequences,
};

const engine = new ZxcvbnFactory({
  dictionary,
  graphs,
  translations,
  maxLength: 256,
});

const samples = [
  "password",
  "Summer2026!",
  "correct horse battery staple",
  "S3cur!ty-P@ssw0rd-2026",
  "xQ9#mL2$vR7!pK5",
];

const matcherGroups = [
  ...Object.entries(engine.matching.matchers).map(([name, matcher]) => ({
    name,
    matcher,
  })),
  ...Object.entries(engine.matching.matchers.wordSequence)
    .filter(([name]) => name !== "options")
    .map(([name, matcher]) => ({
      name: `wordSequence.${name}`,
      matcher,
    })),
];

const counters = new Map();

for (const { name, matcher } of matcherGroups) {
  if (typeof matcher.getRangedDictionaries !== "function") continue;

  const original = matcher.getRangedDictionaries;

  counters.set(name, {
    calls: 0,
    totalMs: 0,
  });

  matcher.getRangedDictionaries = function (...args) {
    const counter = counters.get(name);
    const start = performance.now();

    try {
      return original.apply(this, args);
    } finally {
      counter.calls++;
      counter.totalMs += performance.now() - start;
    }
  };
}

for (let i = 0; i < 10; i++) {
  for (const password of samples) engine.check(password);
}

for (const counter of counters.values()) {
  counter.calls = 0;
  counter.totalMs = 0;
}

const results = [];

for (const password of samples) {
  const start = performance.now();

  for (let i = 0; i < 30; i++) {
    engine.check(password);
  }

  results.push({
    password,
    totalMs: (performance.now() - start) / 30,
  });
}

console.log("\nPREPARATION PROFILER");
console.log("====================");

for (const [name, counter] of counters) {
  console.log(
    `${name.padEnd(28)} calls=${String(counter.calls).padStart(5)}  avg=${(counter.totalMs / Math.max(counter.calls, 1)).toFixed(5)} ms  total=${counter.totalMs.toFixed(3)} ms`
  );
}

console.log("\nCOMPLETE ANALYSIS");
console.log("=================");

for (const result of results) {
  console.log(
    `${result.password.padEnd(32)} ${result.totalMs.toFixed(3)} ms`
  );
}
