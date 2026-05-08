import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./spec",
  timeout: 35_000,
  expect: { timeout: 12_000 },
  use: {
    trace: "retain-on-failure",
  },
});

