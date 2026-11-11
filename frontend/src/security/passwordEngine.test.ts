
import { describe, expect, it } from "vitest";
import { analyzePasswordLocally } from "./passwordEngine";

describe("SENTINEL Password Intelligence Engine", () => {
  it("detects a commonly used password as weak", async () => {
    const result = await analyzePasswordLocally("password123");

    expect(result.score).toBeLessThanOrEqual(1);
    expect(result.guesses).toBeGreaterThan(0);
  });

  it("does not classify a predictable password as very strong", async () => {
    const result = await analyzePasswordLocally("Summer2026!");

    expect(result.score).toBeLessThan(4);
  });

  it("returns a valid score for a long passphrase", async () => {
    const result = await analyzePasswordLocally(
      "correct-horse-battery-staple"
    );

    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(4);
  });

  it("analyzes a random-looking password", async () => {
    const result = await analyzePasswordLocally(
      "T9#vQ2!mZ7@pL5$x"
    );

    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(4);
  });

  it("returns all required analysis fields", async () => {
    const result = await analyzePasswordLocally("ExampleTest123!");

    expect(result).toHaveProperty("score");
    expect(result).toHaveProperty("strength");
    expect(result).toHaveProperty("warning");
    expect(result).toHaveProperty("suggestions");
    expect(result).toHaveProperty("crackTime");
    expect(result).toHaveProperty("guesses");
  });

  it("handles an empty password safely", async () => {
    const result = await analyzePasswordLocally("");

    expect(result.score).toBe(0);
    expect(result.strength).toBe("Very Weak");
    expect(result.guesses).toBeGreaterThan(0);
  });

  it("rejects passwords longer than 256 characters", async () => {
    const oversizedPassword = "A".repeat(257);

    await expect(
      analyzePasswordLocally(oversizedPassword)
    ).rejects.toThrow(RangeError);
  });
});
