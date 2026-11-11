import { ZxcvbnFactory } from "@zxcvbn-ts/core";

import passwords from "@zxcvbn-ts/language-common/dist/passwords.json.mjs";
import diceware from "@zxcvbn-ts/language-common/dist/diceware.json.mjs";
import graphs from "@zxcvbn-ts/language-common/dist/adjacencyGraphs.json.mjs";

import commonWords from "@zxcvbn-ts/language-en/dist/commonWords.json.mjs";
import firstnames from "@zxcvbn-ts/language-en/dist/firstnames.json.mjs";
import wordSequences from "@zxcvbn-ts/language-en/dist/wordSequences.json.mjs";
import translations from "@zxcvbn-ts/language-en/dist/translations.mjs";

const engine = new ZxcvbnFactory({
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

const matchers = Object.entries(
  engine.matching.matchers.wordSequence,
).filter(([name]) => name !== "options");

console.log("MATCHER CONFIGURATION");

for (const [name, matcher] of matchers) {
  console.log(`\n${name}`);
  console.log("wordSequenceCheck:", matcher.wordSequenceCheck);
  console.log("options exists:", Boolean(matcher.options));
  console.log(
    "rankedDictionaries writable:",
    Object.getOwnPropertyDescriptor(
      matcher.options,
      "rankedDictionaries",
    )?.writable,
  );
  console.log(
    "rankedDictionaries object extensible:",
    Object.isExtensible(matcher.options.rankedDictionaries),
  );
}

console.log("\nSHARED CONFIGURATION");

for (let i = 1; i < matchers.length; i++) {
  console.log(
    `${matchers[0][0]} and ${matchers[i][0]} share options:`,
    matchers[0][1].options === matchers[i][1].options,
  );
}

console.log("\nDICTIONARY CONFIGURATION");

console.log(
  "Dictionary count:",
  Object.keys(matchers[0][1].options.rankedDictionaries).length,
);

console.log(
  "Word-sequence dictionary count:",
  Object.keys(matchers[0][1].options.rankedDictionaries)
    .filter((key) => matchers[0][1].options.isWordSequence(key)).length,
);
