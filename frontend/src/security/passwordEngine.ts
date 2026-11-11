
import { ZxcvbnFactory } from "@zxcvbn-ts/core";
import { installWordSequenceCache } from "./wordSequenceCache";

// SENTINEL configuration
const MAX_PASSWORD_LENGTH = 256;

// Keep one initialization promise so concurrent requests share
// the same dictionary downloads and engine instance.
let enginePromise: ReturnType<typeof createEngine> | undefined;

// Load the complete dictionaries asynchronously.
async function createEngine() {
  const [
    passwordsModule,
    dicewareModule,
    adjacencyGraphsModule,
    commonWordsModule,
    firstnamesModule,
    wordSequencesModule,
    translationsModule,
  ] = await Promise.all([
    import("@zxcvbn-ts/language-common/dist/passwords.json.mjs"),
    import("@zxcvbn-ts/language-common/dist/diceware.json.mjs"),
    import("@zxcvbn-ts/language-common/dist/adjacencyGraphs.json.mjs"),
    import("@zxcvbn-ts/language-en/dist/commonWords.json.mjs"),
    import("@zxcvbn-ts/language-en/dist/firstnames.json.mjs"),
    import("@zxcvbn-ts/language-en/dist/wordSequences.json.mjs"),
    import("@zxcvbn-ts/language-en/dist/translations.mjs"),
  ]);

  // Preserve every existing dictionary and matcher input.
  const dictionary = {
    "passwords-common": passwordsModule.default,
    "diceware-common": dicewareModule.default,
    "commonWords-en": commonWordsModule.default,
    "firstnames-en": firstnamesModule.default,
    ...wordSequencesModule.default,
  };

  // Initialize the local password intelligence engine.
  const engine = new ZxcvbnFactory({
    dictionary,
    graphs: adjacencyGraphsModule.default,
    translations: translationsModule.default,
    maxLength: MAX_PASSWORD_LENGTH,
    l33tMaxSubstitutions: 100,
  });

  // Install the optional cache only after engine initialization.
  const cacheStatus = installWordSequenceCache(engine);

  if (!cacheStatus.enabled) {
    console.warn(
      "[SENTINEL] Word-sequence cache unavailable. Using original matcher methods.",
      cacheStatus.reason,
    );
  }

  return engine;
}

// Reuse the initialized engine. Retry initialization if loading fails.
async function getEngine() {
  if (!enginePromise) {
    enginePromise = createEngine();
  }

  try {
    return await enginePromise;
  } catch (error) {
    enginePromise = undefined;
    throw error;
  }
}

// Password analysis response structure.
export interface PasswordAnalysis {
  score: number;
  strength: string;
  warning: string | null;
  suggestions: string[];
  crackTime: string;
  guesses: number;
}

// Analyze passwords locally in the browser.
export async function analyzePasswordLocally(
  password: string,
): Promise<PasswordAnalysis> {
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new RangeError(
      `Password must not exceed ${MAX_PASSWORD_LENGTH} characters.`,
    );
  }

  const engine = await getEngine();
  const result = engine.check(password);

  const strengthLevels = [
    "Very Weak",
    "Weak",
    "Fair",
    "Strong",
    "Very Strong",
  ];

  return {
    score: result.score,
    strength: strengthLevels[result.score],
    warning: result.feedback.warning,
    suggestions: result.feedback.suggestions,
    crackTime:
      result.crackTimes.offlineSlowHashingXPerSecond.display,
    guesses: result.guesses,
  };
}
