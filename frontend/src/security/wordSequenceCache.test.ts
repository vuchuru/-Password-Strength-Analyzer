import { describe, expect, it } from "vitest";
import { ZxcvbnFactory } from "@zxcvbn-ts/core";

import passwords from "@zxcvbn-ts/language-common/dist/passwords.json.mjs";
import diceware from "@zxcvbn-ts/language-common/dist/diceware.json.mjs";
import graphs from "@zxcvbn-ts/language-common/dist/adjacencyGraphs.json.mjs";

import commonWords from "@zxcvbn-ts/language-en/dist/commonWords.json.mjs";
import firstnames from "@zxcvbn-ts/language-en/dist/firstnames.json.mjs";
import wordSequences from "@zxcvbn-ts/language-en/dist/wordSequences.json.mjs";
import translations from "@zxcvbn-ts/language-en/dist/translations.mjs";

import { installWordSequenceCache } from "./wordSequenceCache";

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

function getWordSequenceMatchers(engine: ZxcvbnFactory) {
  const internalEngine = engine as unknown as {
    matching: {
      matchers: {
        wordSequence: Record<string, unknown>;
      };
    };
  };

  return Object.entries(
    internalEngine.matching.matchers.wordSequence,
  )
    .filter(([name]) => name !== "options")
    .map(([, matcher]) => matcher as {
      options: {
        rankedDictionaries: Record<string, unknown>;
        rankedDictionariesMaxWordSize: Record<string, number>;
      };
      wordSequenceCheck: boolean;
      getRangedDictionaries: () => {
        rankedDictionaries: Record<string, unknown>;
        rankedDictionariesMaxWordSize: Record<string, number>;
      };
    });
}

describe("SENTINEL word-sequence cache", () => {
  it("installs on the expected factory structure", () => {
    const engine = createEngine();
    const status = installWordSequenceCache(engine);

    expect(status.enabled).toBe(true);
    expect(status.reason).toBeUndefined();
  });

  it("shares one cached result across all three matchers", () => {
    const engine = createEngine();
    const status = installWordSequenceCache(engine);

    expect(status.enabled).toBe(true);

    const matchers = getWordSequenceMatchers(engine);
    const results = matchers.map((matcher) =>
      matcher.getRangedDictionaries(),
    );

    expect(results).toHaveLength(3);
    expect(results[0]).toBe(results[1]);
    expect(results[1]).toBe(results[2]);
    expect(Object.keys(results[0].rankedDictionaries)).toHaveLength(14);
  });

  it("rebuilds after ranked dictionary configuration is replaced", () => {
    const engine = createEngine();
    const status = installWordSequenceCache(engine);

    expect(status.enabled).toBe(true);

    const matchers = getWordSequenceMatchers(engine);
    const first = matchers[0].getRangedDictionaries();
    const options = matchers[0].options;

    const replacement = {
      ...options.rankedDictionaries,
      "months-en": {
        ...options.rankedDictionaries["months-en"] as Record<string, unknown>,
        "__sentinel_test_probe__": 123,
      },
    };

    options.rankedDictionaries = replacement;

    const second = matchers[0].getRangedDictionaries();

    expect(second).not.toBe(first);
    expect(second.rankedDictionaries["months-en"]).toBe(
      replacement["months-en"],
    );
  });

  it("falls back when one matcher becomes incompatible", () => {
    const engine = createEngine();
    const status = installWordSequenceCache(engine);

    expect(status.enabled).toBe(true);

    const matchers = getWordSequenceMatchers(engine);
    const originalFlag = matchers[1].wordSequenceCheck;

    try {
      matchers[1].wordSequenceCheck = false;

      const first = matchers[0].getRangedDictionaries();
      const second = matchers[1].getRangedDictionaries();
      const third = matchers[2].getRangedDictionaries();

      expect(first).not.toBe(second);
      expect(second).not.toBe(third);
    } finally {
      matchers[1].wordSequenceCheck = originalFlag;
    }
  });

  it("preserves analysis results compared with an untouched engine", () => {
    const baseline = createEngine();
    const cached = createEngine();

    const status = installWordSequenceCache(cached);

    expect(status.enabled).toBe(true);

    const samples = [
      "password123",
      "Summer2026!",
      "correct-horse-battery-staple",
      "SENTINEL-Demo-Password-2026!",
      "x9$Kp2!vQ7#mL5@z",
      "P@$$w0rd!2026",
    ];

    for (const password of samples) {
      const baselineResult = baseline.check(password);
      const cachedResult = cached.check(password);

      const {
        calcTime: baselineTime,
        ...baselineStable
      } = baselineResult;

      const {
        calcTime: cachedTime,
        ...cachedStable
      } = cachedResult;

      expect(cachedStable).toEqual(baselineStable);
    }
  });
});
