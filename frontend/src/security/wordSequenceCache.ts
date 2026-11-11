type RankedDictionaryMap = Record<string, unknown>;

type CacheOptions = {
  rankedDictionaries: RankedDictionaryMap;
  rankedDictionariesMaxWordSize: Record<string, number>;
  wordSequenceNames: string[];
  isWordSequence: (key: string) => boolean;
};

type RangedDictionaries = {
  rankedDictionaries: RankedDictionaryMap;
  rankedDictionariesMaxWordSize: Record<string, number>;
};

type GetRangedDictionaries = (
  this: MatcherLike,
  ...args: unknown[]
) => RangedDictionaries;

type MatcherLike = {
  options: CacheOptions;
  wordSequenceCheck: boolean;
  getRangedDictionaries: GetRangedDictionaries;
};

type ConfigurationSnapshot = {
  optionsRef: CacheOptions;
  rankedRef: RankedDictionaryMap;
  maxSizesRef: Record<string, number>;
  namesRef: string[];
  classifierRef: CacheOptions["isWordSequence"];
  names: string[];
  rankedEntries: [string, unknown][];
  maxSizeEntries: [string, unknown][];
};

export interface WordSequenceCacheStatus {
  enabled: boolean;
  reason?: string;
  metrics: {
    hits: number;
    rebuilds: number;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isCacheOptions(value: unknown): value is CacheOptions {
  if (!isRecord(value)) return false;

  return (
    isRecord(value.rankedDictionaries) &&
    isRecord(value.rankedDictionariesMaxWordSize) &&
    Array.isArray(value.wordSequenceNames) &&
    typeof value.isWordSequence === "function"
  );
}

function isMatcherLike(value: unknown): value is MatcherLike {
  if (!isRecord(value)) return false;

  return (
    value.wordSequenceCheck === true &&
    isCacheOptions(value.options) &&
    typeof value.getRangedDictionaries === "function"
  );
}

function getEnumerableEntries(
  object: Record<string, unknown>,
): [string, unknown][] {
  return Object.keys(object).map((key) => [key, object[key]]);
}

function entriesStillMatch(
  object: Record<string, unknown>,
  snapshotEntries: [string, unknown][],
): boolean {
  const currentKeys = Object.keys(object);

  if (currentKeys.length !== snapshotEntries.length) {
    return false;
  }

  for (const [key, previousValue] of snapshotEntries) {
    if (!Object.hasOwn(object, key)) return false;

    if (!Object.is(object[key], previousValue)) {
      return false;
    }
  }

  return true;
}

function captureConfiguration(
  options: CacheOptions,
): ConfigurationSnapshot {
  return {
    optionsRef: options,
    rankedRef: options.rankedDictionaries,
    maxSizesRef: options.rankedDictionariesMaxWordSize,
    namesRef: options.wordSequenceNames,
    classifierRef: options.isWordSequence,

    names: [...options.wordSequenceNames],

    rankedEntries: getEnumerableEntries(
      options.rankedDictionaries,
    ),

    maxSizeEntries: getEnumerableEntries(
      options.rankedDictionariesMaxWordSize,
    ),
  };
}

function configurationStillMatches(
  options: CacheOptions,
  snapshot: ConfigurationSnapshot,
): boolean {
  if (options !== snapshot.optionsRef) return false;

  if (options.rankedDictionaries !== snapshot.rankedRef) {
    return false;
  }

  if (
    options.rankedDictionariesMaxWordSize !==
    snapshot.maxSizesRef
  ) {
    return false;
  }

  if (options.wordSequenceNames !== snapshot.namesRef) {
    return false;
  }

  if (options.isWordSequence !== snapshot.classifierRef) {
    return false;
  }

  const currentNames = options.wordSequenceNames;

  if (currentNames.length !== snapshot.names.length) {
    return false;
  }

  for (let index = 0; index < snapshot.names.length; index++) {
    if (currentNames[index] !== snapshot.names[index]) {
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

function getMatchers(engine: unknown): MatcherLike[] {
  if (!isRecord(engine)) {
    throw new Error("Factory instance is unavailable.");
  }

  const matching = engine.matching;

  if (!isRecord(matching) || !isRecord(matching.matchers)) {
    throw new Error("Factory matcher structure is unavailable.");
  }

  const wordSequence = matching.matchers.wordSequence;

  if (!isRecord(wordSequence)) {
    throw new Error("Word-sequence matcher group is unavailable.");
  }

  const matchers = Object.entries(wordSequence)
    .filter(([name]) => name !== "options")
    .map(([, matcher]) => matcher)
    .filter(isMatcherLike);

  if (matchers.length !== 3) {
    throw new Error(
      `Expected 3 compatible word-sequence matchers; found ${matchers.length}.`,
    );
  }

  return matchers;
}

export function installWordSequenceCache(
  engine: unknown,
): WordSequenceCacheStatus {
  const metrics = {
    hits: 0,
    rebuilds: 0,
  };

  const originalMethods = new Map<
    MatcherLike,
    GetRangedDictionaries
  >();

  try {
    const matchers = getMatchers(engine);
    const options = matchers[0].options;

    if (!matchers.every((matcher) => matcher.options === options)) {
      throw new Error("Matchers do not share the same options.");
    }

    if (!matchers.every((matcher) => matcher.wordSequenceCheck)) {
      throw new Error("Matcher compatibility check failed.");
    }

    for (const matcher of matchers) {
      originalMethods.set(
        matcher,
        matcher.getRangedDictionaries,
      );
    }

    const originalMethod = originalMethods.get(matchers[0]);

    if (
      !originalMethod ||
      !matchers.every(
        (matcher) =>
          originalMethods.get(matcher) === originalMethod,
      )
    ) {
      throw new Error("Original matcher methods differ.");
    }

    let cachedResult: RangedDictionaries | null = null;
    let snapshot: ConfigurationSnapshot | null = null;

    const canShareCache = (): boolean =>
      matchers.every(
        (matcher) =>
          matcher.options === options &&
          matcher.wordSequenceCheck === true,
      );

    const getSharedResult = (): RangedDictionaries => {
      if (
        cachedResult !== null &&
        snapshot !== null &&
        configurationStillMatches(options, snapshot)
      ) {
        metrics.hits++;
        return cachedResult;
      }

      cachedResult = originalMethod.call(matchers[0]);

      snapshot = captureConfiguration(options);
      metrics.rebuilds++;

      return cachedResult;
    };

    for (const matcher of matchers) {
      const original = originalMethods.get(matcher);

      if (!original) {
        throw new Error("Original matcher method is unavailable.");
      }

      matcher.getRangedDictionaries = function (
        this: MatcherLike,
        ...args: unknown[]
      ): RangedDictionaries {
        if (!canShareCache()) {
          return original.apply(this, args);
        }

        return getSharedResult();
      };
    }

    // Build the initial shared cache immediately.
    getSharedResult();

    return {
      enabled: true,
      metrics,
    };
  } catch (error) {
    // Restore every method that was successfully patched.
    for (const [matcher, original] of originalMethods) {
      try {
        matcher.getRangedDictionaries = original;
      } catch {
        // Preserve the original installation failure.
      }
    }

    return {
      enabled: false,
      reason:
        error instanceof Error
          ? error.message
          : "Unknown cache initialization error.",
      metrics,
    };
  }
}
