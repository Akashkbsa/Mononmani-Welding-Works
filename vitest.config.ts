import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Unit tests for the React side: jsdom stands in for the window; Tauri is mocked per test.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    restoreMocks: true,
  },
});
