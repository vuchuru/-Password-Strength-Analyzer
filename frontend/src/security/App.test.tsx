
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import App from "../App";
import { analyzePasswordLocally } from "./passwordEngine";

vi.mock("./passwordEngine", () => ({
  analyzePasswordLocally: vi.fn(),
}));

describe("SENTINEL automatic password clearing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("clears the password, hides it, and preserves results after successful analysis", async () => {
    const user = userEvent.setup();

    vi.mocked(analyzePasswordLocally).mockResolvedValue({
      score: 3,
      strength: "Strong",
      warning: null,
      suggestions: [],
      crackTime: "Several years",
      guesses: 1000000,
    });

    render(<App />);

    const input = screen.getByLabelText("Password") as HTMLInputElement;

    await user.type(input, "TestPassword123!");

    await user.click(
      screen.getByRole("button", { name: "Show password" })
    );

    expect(input.type).toBe("text");

    await user.click(
      screen.getByRole("button", { name: "Analyze Password" })
    );

    await waitFor(() => {
      expect(input.value).toBe("");
      expect(input.type).toBe("password");
    });

    expect(
      screen.getByRole("button", { name: "Show password" })
    ).toBeTruthy();

    expect(screen.getByText("Strong")).toBeTruthy();
    expect(screen.getByText("Several years")).toBeTruthy();

    expect(analyzePasswordLocally).toHaveBeenCalledWith(
      "TestPassword123!"
    );
  });

  it("clears the password even when analysis fails", async () => {
    const user = userEvent.setup();

    vi.mocked(analyzePasswordLocally).mockRejectedValue(
      new Error("Simulated analysis failure")
    );

    render(<App />);

    const input = screen.getByLabelText("Password") as HTMLInputElement;

    await user.type(input, "TestPassword123!");

    await user.click(
      screen.getByRole("button", { name: "Analyze Password" })
    );

    await waitFor(() => {
      expect(input.value).toBe("");
      expect(input.type).toBe("password");
    });

    expect(screen.getByRole("alert").textContent).toContain(
      "Local password analysis failed"
    );
  });
});
