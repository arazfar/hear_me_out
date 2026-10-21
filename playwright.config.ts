import { defineConfig } from "@playwright/test";
const rtcPort = Number(process.env.TEST_RTC_PORT || 3102);
const relayPort = Number(process.env.TEST_RELAY_PORT || 3103);
const rtcURL = `http://127.0.0.1:${rtcPort}`;
const relayURL = `http://127.0.0.1:${relayPort}`;
export default defineConfig({
  testDir: "./tests/browser",
  // Hosted runners also close two browser contexts inside this budget.
  // Individual gameplay and recovery deadlines remain unchanged.
  timeout: process.env.CI ? 180000 : 120000,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  fullyParallel: false,
  expect: { timeout: 15000 },
  outputDir: "output/playwright/results",
  reporter: [
    ["list"],
    ["json", { outputFile: "output/playwright/results.json" }],
  ],
  use: {
    headless: true,
    viewport: { width: 1280, height: 720 },
    permissions: ["camera", "microphone"],
    // Tracing every routed audio packet can starve real-time delivery on hosted
    // VMs. CI retains structured diagnostics and explicit screenshots instead.
    trace: process.env.CI ? "off" : "retain-on-failure",
    launchOptions: {
      args: [
        "--use-fake-device-for-media-stream",
        "--use-fake-ui-for-media-stream",
        "--autoplay-policy=no-user-gesture-required",
      ],
    },
  },
  projects: [
    {
      name: "rtc",
      use: { channel: "chrome", baseURL: rtcURL },
    },
    {
      name: "relay",
      use: { channel: "chrome", baseURL: relayURL },
    },
    {
      name: "phone",
      grep: /two players|phone layouts/,
      use: { channel: "chrome", baseURL: rtcURL },
    },
    {
      name: "phone-relay",
      grep: /two players|phone layouts/,
      use: { channel: "chrome", baseURL: relayURL },
    },
    {
      name: "webkit",
      grep: /two players|phone layouts/,
      use: {
        browserName: "webkit",
        channel: undefined,
        baseURL: rtcURL,
        launchOptions: { args: [] },
      },
    },
    {
      name: "webkit-relay",
      grep: /two players|phone layouts/,
      use: {
        browserName: "webkit",
        channel: undefined,
        baseURL: relayURL,
        launchOptions: { args: [] },
      },
    },
  ],
  webServer: [
    {
      command: `PORT=${rtcPort} pnpm exec tsx scripts/browser-fixture.ts`,
      url: `${rtcURL}/healthz`,
      reuseExistingServer: false,
    },
    {
      command: `PORT=${relayPort} FORCE_WSS=true pnpm exec tsx scripts/browser-fixture.ts`,
      url: `${relayURL}/healthz`,
      reuseExistingServer: false,
    },
  ],
});
