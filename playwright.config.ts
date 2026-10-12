import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  timeout: 120000,
  workers: 1,
  fullyParallel: false,
  expect: { timeout: 15000 },
  outputDir: "output/playwright/results",
  reporter: [
    ["list"],
    ["json", { outputFile: "output/playwright/results.json" }],
  ],
  use: {
    channel: "chrome",
    headless: true,
    viewport: { width: 1280, height: 720 },
    permissions: ["camera", "microphone"],
    trace: "retain-on-failure",
    launchOptions: {
      args: [
        "--use-fake-device-for-media-stream",
        "--use-fake-ui-for-media-stream",
        "--autoplay-policy=no-user-gesture-required",
      ],
    },
  },
  projects: [
    { name: "rtc", use: { baseURL: "http://127.0.0.1:3102" } },
    { name: "relay", use: { baseURL: "http://127.0.0.1:3103" } },
  ],
  webServer: [
    {
      command: "PORT=3102 pnpm exec tsx scripts/browser-fixture.ts",
      url: "http://127.0.0.1:3102/healthz",
      reuseExistingServer: false,
    },
    {
      command:
        "PORT=3103 FORCE_WSS=true pnpm exec tsx scripts/browser-fixture.ts",
      url: "http://127.0.0.1:3103/healthz",
      reuseExistingServer: false,
    },
  ],
});
