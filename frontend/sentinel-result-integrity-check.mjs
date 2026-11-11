
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
});

const password = "password123";

const first = engine.check(password);
const second = engine.check(password);

console.log("========================================");
console.log(" SENTINEL RESULT INTEGRITY CHECK");
console.log("========================================");

console.log("First result score:", first.score);
console.log("Second result score:", second.score);

console.log(
  "First result keys:",
  Object.keys(first),
);

console.log(
  "Second result keys:",
  Object.keys(second),
);

const firstJSON = JSON.stringify(first);
const secondJSON = JSON.stringify(second);

console.log(
  "Complete results identical:",
  firstJSON === secondJSON,
);

if (firstJSON !== secondJSON) {
  console.log("");
  console.log("FIRST RESULT:");
  console.log(firstJSON);

  console.log("");
  console.log("SECOND RESULT:");
  console.log(secondJSON);
} else {
  console.log("");
  console.log("Uninstrumented results are stable.");
}
