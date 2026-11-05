import { defineConfig } from "@playwright/test";
import path from "node:path";
import { repositoryRoot } from "./review.mjs";
export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.mjs",
  timeout: 30000,
  expect: { timeout: 7000 },
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  outputDir: path.join(repositoryRoot, "output/ui-review-tests/results"),
  reporter: [
    ["list"],
    [
      "json",
      {
        outputFile: path.join(
          repositoryRoot,
          "output/ui-review-tests/results.json",
        ),
      },
    ],
  ],
  use: { viewport: { width: 1600, height: 1050 }, trace: "retain-on-failure" },
  projects: [
    {
      name: "chromium",
      grepInvert: /@focus/,
      use: { browserName: "chromium", channel: "chrome" },
    },
    { name: "webkit", grepInvert: /@focus/, use: { browserName: "webkit" } },
    {
      name: "chromium-focus",
      grep: /@focus/,
      use: { browserName: "chromium", channel: "chrome", headless: false },
    },
  ],
});
