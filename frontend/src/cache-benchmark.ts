import { ZxcvbnFactory } from "@zxcvbn-ts/core";

import passwords from "@zxcvbn-ts/language-common/dist/passwords.json.mjs";
import diceware from "@zxcvbn-ts/language-common/dist/diceware.json.mjs";
import graphs from "@zxcvbn-ts/language-common/dist/adjacencyGraphs.json.mjs";

import commonWords from "@zxcvbn-ts/language-en/dist/commonWords.json.mjs";
import firstnames from "@zxcvbn-ts/language-en/dist/firstnames.json.mjs";
import wordSequences from "@zxcvbn-ts/language-en/dist/wordSequences.json.mjs";
import translations from "@zxcvbn-ts/language-en/dist/translations.mjs";

import { installWordSequenceCache } from "./security/wordSequenceCache";

const WARMUP_ROUNDS = 10;
const MEASURED_ROUNDS = 40;

const samples = [
  { label: "Common password", value: "password123" },
  { label: "Predictable password", value: "Summer2026!" },
  { label: "Passphrase", value: "correct-horse-battery-staple" },
  { label: "Mixed password", value: "SENTINEL-Demo-Password-2026!" },
  { label: "Random-looking password", value: "x9$Kp2!vQ7#mL5@z" },
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

function stableResult(result: ReturnType<ZxcvbnFactory["check"]>) {
  const { calcTime: _calcTime, ...stable } = result;
  return JSON.stringify(stable);
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function percentile95(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.95) - 1];
}

function format(value: number) {
  return `${value.toFixed(3)} ms`;
}

const button = document.querySelector<HTMLButtonElement>("#runBenchmark");
const output = document.querySelector<HTMLPreElement>("#output");

if (!button || !output) {
  throw new Error("Benchmark page elements are missing.");
}

button.addEventListener("click", async () => {
  button.disabled = true;
  output.textContent = "Initializing identical engines...\n";

  try {
    const baseline = createEngine();
    const cached = createEngine();

    const cacheStatus = installWordSequenceCache(cached);

    if (!cacheStatus.enabled) {
      throw new Error(
        `Cache installation failed: ${cacheStatus.reason ?? "Unknown reason"}`,
      );
    }

    const reports: string[] = [];
    let baselineMedianSum = 0;
    let cachedMedianSum = 0;

    output.textContent =
      "Running warm-ups and measurements. Please keep this tab open...\n";

    for (const sample of samples) {
      const baselineTimes: number[] = [];
      const cachedTimes: number[] = [];

      // Warm up both engines before collecting measurements.
      for (let i = 0; i < WARMUP_ROUNDS; i++) {
        baseline.check(sample.value);
        cached.check(sample.value);
      }

      // Alternate execution order to reduce ordering bias.
      for (let i = 0; i < MEASURED_ROUNDS; i++) {
        let baselineResult;
        let cachedResult;
        let baselineDuration: number;
        let cachedDuration: number;

        if (i % 2 === 0) {
          let start = performance.now();
          baselineResult = baseline.check(sample.value);
          baselineDuration = performance.now() - start;

          start = performance.now();
          cachedResult = cached.check(sample.value);
          cachedDuration = performance.now() - start;
        } else {
          let start = performance.now();
          cachedResult = cached.check(sample.value);
          cachedDuration = performance.now() - start;

          start = performance.now();
          baselineResult = baseline.check(sample.value);
          baselineDuration = performance.now() - start;
        }

        if (
          stableResult(baselineResult) !== stableResult(cachedResult)
        ) {
          throw new Error(
            `Analysis result mismatch in scenario: ${sample.label}`,
          );
        }

        baselineTimes.push(baselineDuration);
        cachedTimes.push(cachedDuration);
      }

      const baselineMedian = median(baselineTimes);
      const cachedMedian = median(cachedTimes);

      const improvement =
        ((baselineMedian - cachedMedian) / baselineMedian) * 100;

      baselineMedianSum += baselineMedian;
      cachedMedianSum += cachedMedian;

      reports.push(
        [
          sample.label,
          `  Baseline median: ${format(baselineMedian)}`,
          `  Cached median:   ${format(cachedMedian)}`,
          `  Baseline p95:    ${format(percentile95(baselineTimes))}`,
          `  Cached p95:      ${format(percentile95(cachedTimes))}`,
          `  Change:          ${improvement.toFixed(2)}%`,
          "  Result integrity: PASS",
        ].join("\n"),
      );

      output.textContent =
        `Completed ${reports.length}/${samples.length} scenarios...\n\n` +
        reports.join("\n\n");

      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }

    const aggregateChange =
      ((baselineMedianSum - cachedMedianSum) / baselineMedianSum) * 100;

    output.textContent = [
      "SENTINEL BROWSER BENCHMARK",
      "========================================",
      `Warm-up rounds per engine: ${WARMUP_ROUNDS}`,
      `Measured rounds per scenario: ${MEASURED_ROUNDS}`,
      "Execution order: Alternating",
      "Result integrity: All comparisons passed",
      "",
      ...reports,
      "",
      "AGGREGATE",
      "========================================",
      `Baseline median sum: ${format(baselineMedianSum)}`,
      `Cached median sum:   ${format(cachedMedianSum)}`,
      `Aggregate change:    ${aggregateChange.toFixed(2)}%`,
      "",
      "CACHE METRICS",
      "========================================",
      `Enabled: ${cacheStatus.enabled}`,
      `Hits: ${cacheStatus.metrics.hits}`,
      `Rebuilds: ${cacheStatus.metrics.rebuilds}`,
      "",
      "Note: Aggregate change is based on the sum of scenario medians.",
      "It is not a universal performance guarantee.",
      "No password values are included in this report.",
    ].join("\n");
  } catch (error) {
    output.textContent =
      "BENCHMARK FAILED\n\n" +
      (error instanceof Error ? error.message : "Unknown error.");
  } finally {
    button.disabled = false;
  }
});
