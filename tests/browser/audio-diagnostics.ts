import type { APIRequestContext, Page, TestInfo } from "@playwright/test";

/** Synthetic fixture data only; capture before contexts close, even when an
 * assertion fails. Individual failures must not prevent the other attachments. */
export async function attachAudioDiagnostics(
  pages: Page[],
  request: APIRequestContext,
  code: string | undefined,
  info: TestInfo,
  failed: boolean,
) {
  await Promise.allSettled([
    ...pages.map(async (page, index) => {
      const samples = await page.evaluate(() => {
        const w = window as any;
        return {
          captionSamples: (w.__captionSamples || []).slice(-1200),
          renderEvents: (w.__judgeRender || []).slice(-512),
          conversation: (w.__conversation || []).slice(-1200),
          microphone: (w.__micFrames || []).slice(-30),
          received: (w.__receivedFrames || []).slice(-30),
        };
      });
      await info.attach(`audio-samples-${index}`, {
        body: Buffer.from(JSON.stringify(samples)),
        contentType: "application/json",
      });
    }),
    ...(code
      ? ["state", "timeline"].map(async (kind) => {
          const response = await request.post(`/__test/${kind}/${code}`, {
            timeout: 1500,
          });
          await info.attach(`audio-${kind}`, {
            body: await response.body(),
            contentType: "application/json",
          });
        })
      : []),
    ...(failed
      ? pages.map(async (page, index) => {
          await info.attach(`audio-failure-${index}`, {
            body: await page.screenshot({ timeout: 1500 }),
            contentType: "image/png",
          });
        })
      : []),
  ]);
}
