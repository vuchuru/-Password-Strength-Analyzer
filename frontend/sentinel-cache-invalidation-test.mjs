import assert from "node:assert/strict";
import { ZxcvbnFactory } from "@zxcvbn-ts/core";

import passwords from "@zxcvbn-ts/language-common/dist/passwords.json.mjs";
import diceware from "@zxcvbn-ts/language-common/dist/diceware.json.mjs";
import adjacencyGraphs from "@zxcvbn-ts/language-common/dist/adjacencyGraphs.json.mjs";

import commonWords from "@zxcvbn-ts/language-en/dist/commonWords.json.mjs";
import firstnames from "@zxcvbn-ts/language-en/dist/firstnames.json.mjs";
import wordSequences from "@zxcvbn-ts/language-en/dist/wordSequences.json.mjs";
import translations from "@zxcvbn-ts/language-en/dist/translations.mjs";

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
  maxLength: 256,
  l33tMaxSubstitutions: 100,
});

const options = engine.matching.matchers.wordSequence.dictionary.options;
const matcher = engine.matching.matchers.wordSequence.dictionary;
const getFiltered = () => matcher.getRangedDictionaries();

console.log("INITIAL CONFIGURATION");
assert.equal(Object.keys(getFiltered().rankedDictionaries).length, 14);
console.log("PASS: 14 initial dictionaries");

// TEST 1: Replace ranked dictionaries using an existing valid prefix.
const originalRanked = options.rankedDictionaries;

options.rankedDictionaries = {
  ...originalRanked,
  "months-custom": {},
};

assert.ok("months-custom" in getFiltered().rankedDictionaries);
console.log("PASS: rankedDictionaries replacement detected");

// TEST 2: Replace maximum word-size object.
const originalMaxSizes = options.rankedDictionariesMaxWordSize;

options.rankedDictionariesMaxWordSize = {
  ...originalMaxSizes,
  "months-en": 123,
};

assert.equal(
  getFiltered().rankedDictionariesMaxWordSize["months-en"],
  123
);
console.log("PASS: maximum word-size replacement detected");

// TEST 3: Modify wordSequenceNames in place.
const originalNames = [...options.wordSequenceNames];

options.wordSequenceNames.push("customSequence");

options.rankedDictionaries = {
  ...options.rankedDictionaries,
  "customSequence-en": {},
};

options.rankedDictionariesMaxWordSize = {
  ...options.rankedDictionariesMaxWordSize,
  "customSequence-en": 10,
};

assert.ok("customSequence-en" in getFiltered().rankedDictionaries);
console.log("PASS: in-place wordSequenceNames modification detected");

// Restore original configuration.
options.rankedDictionaries = originalRanked;
options.rankedDictionariesMaxWordSize = originalMaxSizes;
options.wordSequenceNames.splice(
  0,
  options.wordSequenceNames.length,
  ...originalNames
);

console.log("\nALL THREE TESTS PASSED");
