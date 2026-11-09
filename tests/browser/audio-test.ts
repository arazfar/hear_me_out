import { test } from "@playwright/test";

/** Fixture teardown has its own budget and runs before browser/request disposal,
 * including when Playwright interrupts the test body on timeout. */
export const audioTest = test.extend<{
  audioCleanup: (cleanup: () => Promise<void>) => void;
}>({
  audioCleanup: [
    async ({ browser, request }, use) => {
      let cleanup: (() => Promise<void>) | undefined;
      try {
        await use((value) => {
          cleanup = value;
        });
      } finally {
        await cleanup?.();
      }
    },
    { timeout: 10000 },
  ],
});
