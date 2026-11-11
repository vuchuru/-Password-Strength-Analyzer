
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { bundleAnalyzerPlugin } from "rolldown/experimental";

export default defineConfig({
  plugins: [
    react(),
    bundleAnalyzerPlugin({
      format: "md",
      fileName: "sentinel-bundle-analysis.md",
    }),
  ],
  test: {
    environment: "jsdom",
    globals: true,
    clearMocks: true,
    restoreMocks: true,
  },
});
