import { test, expect, type Page } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
import type { PresentationCase } from "./presentation-fixture";
let server: ViteDevServer, url: string;
test.beforeAll(async () => {
  server = await createServer({
    configFile: false,
    plugins: [react()],
    appType: "custom",
    server: {
      host: "127.0.0.1",
      port: 0,
      watch: { ignored: ["**/output/**", "**/.git/**"] },
    },
  });
  server.middlewares.use("/__presentation", async (_request, response) => {
    response.setHeader("Content-Type", "text/html");
    response.end(
      await server.transformIndexHtml(
        "/__presentation",
        '<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/tests/browser/presentation-fixture.tsx"></script></body></html>',
      ),
    );
  });
  await server.listen();
  url = server.resolvedUrls!.local[0] + "__presentation";
});
test.afterAll(async () => {
  await server?.close();
});

async function settledGeometry(page: Page) {
  await page.evaluate(async () => {
    await window.presentation.ready;
    await document.fonts.ready;
    await new Promise<void>((resolve) => {
      let previous = "",
        stable = 0;
      const frame = () => {
        const next = JSON.stringify(
          [...document.querySelectorAll(".face-picture")].map((node) =>
            node.getBoundingClientRect().toJSON(),
          ),
        );
        stable = next === previous ? stable + 1 : 0;
        previous = next;
        if (stable >= 3) resolve();
        else requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
  });
}

test("phone layouts: transcript dismissal resolves current focus without losing its selected text", async ({
  page,
}, info) => {
  const tab =
    info.project.name.startsWith("webkit") && process.platform === "darwin"
      ? "Alt+Tab"
      : "Tab";
  await page.goto(url);
  await page.waitForFunction(() => !!window.presentation);
  await page.evaluate(() => window.presentation.ready);
  await expect(page.locator(".recovery-panel")).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    for (const change of [
      "unchanged",
      "cleared",
      "replaced",
      "rematch",
    ] as const) {
      for (const dismissal of ["escape", "close", "backdrop"] as const) {
        await page.evaluate(() => window.presentation.show("aligned-caption"));
        const trigger = page.locator(".caption-surface");
        await expect(trigger).toBeVisible();
        const videos = await page.locator(".face video").elementHandles();
        const pictures = () =>
          page
            .locator(".face-picture")
            .evaluateAll((nodes) =>
              nodes.map((node) => node.getBoundingClientRect().toJSON()),
            );
        const before = await pictures();
        await trigger.focus();
        await page.keyboard.press("Enter");
        const reader = page.getByRole("region", { name: "Full transcript" });
        await reader.focus();
        if (change !== "unchanged") {
          await page.evaluate(() =>
            window.presentation.update({ judge: null, captions: {} }),
          );
          await expect(trigger).toHaveCount(0);
          if (change === "replaced")
            await page.evaluate(() =>
              window.presentation.show("aligned-caption"),
            );
          if (change === "rematch")
            await page.evaluate(() =>
              window.presentation.update({
                phase: "LOBBY",
                matchId: "next-match",
                topic: null,
                turn: null,
              }),
            );
        }
        await expect(reader).toHaveText("The court has heard your case.");
        await expect(reader).toBeFocused();
        if (dismissal === "escape") await page.keyboard.press("Escape");
        else if (dismissal === "close")
          await page.getByRole("button", { name: "Close dialog" }).click();
        else await page.mouse.click(1, 1);
        await expect(page.getByRole("dialog")).toHaveCount(0);
        const target = ["unchanged", "replaced"].includes(change)
          ? trigger
          : page.getByRole("button", { name: "Mic & camera", exact: true });
        await expect(target).toBeFocused();
        await page.keyboard.press(tab);
        await expect(target).not.toBeFocused();
        await page.keyboard.press("Shift+" + tab);
        await expect(target).toBeFocused();
        for (const video of videos)
          expect(await video.evaluate((node) => node.isConnected)).toBe(true);
        if (change !== "rematch") expect(await pictures()).toEqual(before);
      }
    }
  }
  await page.evaluate(() => window.presentation.show("aligned-caption"));
  await page.locator(".caption-surface").click();
  await page.evaluate(() => window.presentation.leave());
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".media-trigger")).toHaveCount(0);
  const name = page.getByRole("textbox", { name: "Your name" });
  await name.focus();
  await expect(name).toBeFocused();
  await page.getByRole("button", { name: "How to play" }).focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "How to play" })).toBeFocused();
});

test("phone layouts: pinned recovery panels are complete and share one scroll owner", async ({
  page,
}) => {
  test.setTimeout(120000);
  await page.goto(url);
  await page.waitForFunction(() => !!window.presentation);
  await page.evaluate(() => window.presentation.ready);
  await expect(page.locator(".recovery-panel")).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const names: PresentationCase[] = [
    "mic-repair",
    "camera-repair",
    "private-check",
    "manual-retry",
    "interrupted",
    "mic-off",
    "camera-off",
    "both-off",
    "missing-device",
    "notice",
  ];
  for (const [width, height] of [
    [360, 640],
    [390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    for (const name of names) {
      await page.evaluate((name) => window.presentation.show(name), name);
      await expect(
        page.locator(name === "notice" ? ".turn-panel" : ".recovery-panel"),
      ).toBeVisible();
      await expect
        .poll(
          () =>
            page.evaluate(() => {
              const lower = document.querySelector(".court-lower")!,
                boundary = lower.getBoundingClientRect();
              const panel = document.querySelector(
                  ".recovery-panel,.turn-panel",
                )!,
                box = panel.getBoundingClientRect();
              const controls = [
                ...panel.querySelectorAll("button,summary,meter"),
              ];
              const heading = document.querySelector(".arena-heading")!;
              return {
                clipped: Math.max(
                  0,
                  boundary.top - box.top,
                  box.bottom - boundary.bottom,
                  ...controls.map(
                    (control) =>
                      control.getBoundingClientRect().bottom - boundary.bottom,
                  ),
                ),
                headingOverflow: heading.scrollHeight - heading.clientHeight,
                outer: Math.max(
                  document.documentElement.scrollHeight - innerHeight,
                  ...[
                    ...document.querySelectorAll(".room-scroll,.courtroom"),
                  ].map((n) => n.scrollHeight - n.clientHeight),
                ),
                nested: [...lower.querySelectorAll("*")].filter(
                  (n) =>
                    n.clientHeight &&
                    n.scrollHeight > n.clientHeight + 1 &&
                    ["auto", "scroll"].includes(getComputedStyle(n).overflowY),
                ).length,
              };
            }),
          { message: name + " at " + width },
        )
        .toMatchObject({ clipped: 0, headingOverflow: 0, outer: 0, nested: 0 });
      const heights = await page
        .locator(".face-picture")
        .evaluateAll((nodes) =>
          nodes.map((n) => n.getBoundingClientRect().height),
        );
      heights.forEach((value) =>
        expect(
          Math.abs(value - (height > 740 ? 230.6667 : 96)),
        ).toBeLessThanOrEqual(1),
      );
      if (name === "interrupted") {
        await page.evaluate(() =>
          window.presentation.update({ rematchReady: ["alex"] }),
        );
        const accepted = page.locator(".recovery-panel .primary");
        await expect(accepted).toBeDisabled();
        await expect(accepted).toHaveCSS(
          "background-color",
          "rgb(239, 223, 186)",
        );
        await expect(accepted).toHaveText(/Waiting for Sam|Rematch queued/);
        await expect(accepted.locator(".icon")).toHaveCount(0);
      }
      if (name === "notice")
        await page.getByRole("button", { name: "Dismiss error" }).click();
    }
  }
});

test("phone layouts: expanded recovery scrolls together and retains reader and video nodes", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(url);
  await page.waitForFunction(() => !!window.presentation);
  await page.evaluate(() => window.presentation.ready);
  await expect(page.locator(".recovery-panel")).toBeVisible();
  await page.evaluate(() => window.presentation.show("result-help"));
  await expect(page.locator(".result-panel")).toBeVisible();
  const videos = await page.locator(".face video").elementHandles();
  const pictures = () =>
    page
      .locator(".face-picture")
      .evaluateAll((nodes) =>
        nodes.map((n) => n.getBoundingClientRect().toJSON()),
      );
  await settledGeometry(page);
  const before = await pictures(),
    lower = page.getByRole("region", { name: "Court activity", exact: true });
  await page.getByText("Device help", { exact: true }).click();
  await expect
    .poll(() => lower.evaluate((n) => n.scrollHeight - n.clientHeight))
    .toBeGreaterThan(0);
  expect(
    await lower
      .locator(".result-heading,.device-help,.device-help-body,.result-actions")
      .evaluateAll((nodes) =>
        nodes.every((n) => getComputedStyle(n).overflowY === "visible"),
      ),
  ).toBe(true);
  await lower.hover();
  await page.mouse.wheel(0, 500);
  await expect
    .poll(() => lower.evaluate((n) => n.scrollTop))
    .toBeGreaterThan(0);
  expect(await pictures()).toEqual(before);
  await lower.focus();
  await page.keyboard.press("End");
  await expect
    .poll(() =>
      lower.evaluate((n) => n.scrollHeight - n.clientHeight - n.scrollTop),
    )
    .toBeLessThanOrEqual(1);
  expect(await pictures()).toEqual(before);
  const offset = await lower.evaluate((n) => n.scrollTop);
  await page.evaluate(() => window.presentation.update({ seq: 99 }));
  expect(await lower.evaluate((n) => n.scrollTop)).toBe(offset);
  const transcript = page.getByRole("button", {
    name: "Read Bonk’s full transcript",
  });
  await transcript.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.setViewportSize({ width: 701, height: 844 });
  await expect(
    page.getByRole("region", { name: "Full transcript" }),
  ).toContainText("Last words.");
  await page.setViewportSize({ width: 390, height: 844 });
  await settledGeometry(page);
  await page.keyboard.press("Escape");
  await expect(transcript).toBeFocused();
  for (const video of videos)
    expect(await video.evaluate((node) => node.isConnected)).toBe(true);
  expect(await pictures()).toEqual(before);
  const microphone = page.getByLabel(/^Microphone/);
  await microphone.focus();
  await page.evaluate(() => {
    Object.defineProperty(visualViewport!, "height", {
      configurable: true,
      value: 400,
    });
    visualViewport!.dispatchEvent(new Event("resize"));
  });
  await expect
    .poll(() =>
      microphone.evaluate((node) => {
        const field = node.getBoundingClientRect(),
          region = node.closest(".court-lower")!.getBoundingClientRect();
        return (
          field.top >= region.top - 1 &&
          field.bottom <= region.bottom + 1 &&
          region.height >= 44
        );
      }),
    )
    .toBe(true);
  await expect(microphone).toBeFocused();
  await page.evaluate(() => {
    Reflect.deleteProperty(visualViewport!, "height");
    visualViewport!.dispatchEvent(new Event("resize"));
  });
  await expect.poll(pictures).toEqual(before);
  await page.evaluate(() => window.presentation.show("mic-repair"));
  await expect.poll(() => lower.evaluate((n) => n.scrollTop)).toBe(0);
  await expect(page.locator(".recovery-panel")).toBeVisible();
});

test("phone layouts: short landscape notice keeps the complete turn reachable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto(url);
  await page.waitForFunction(() => !!window.presentation);
  await page.evaluate(() => window.presentation.ready);
  await expect(page.locator(".recovery-panel")).toBeVisible();
  await page.evaluate(() => window.presentation.show("notice"));
  const actions = page.getByRole("region", {
    name: "Game actions",
    exact: true,
  });
  const done = page.getByRole("button", { name: "I’m done", exact: true });
  await done.focus();
  await expect
    .poll(() =>
      done.evaluate((node) => {
        const r = node.getBoundingClientRect(),
          region = node.closest(".phase-content")!.getBoundingClientRect();
        return r.top >= region.top - 1 && r.bottom <= region.bottom + 1;
      }),
    )
    .toBe(true);
  await actions.focus();
  await page.keyboard.press("Home");
  await expect.poll(() => actions.evaluate((node) => node.scrollTop)).toBe(0);
  expect(
    await page.locator(".turn-context").evaluate((node) => node.clientHeight),
  ).toBeGreaterThan(0);
  expect(
    await page
      .locator(".turn-context")
      .evaluate((node) => getComputedStyle(node).overflowY),
  ).toBe("visible");
  expect(
    await page.evaluate(() =>
      Math.max(
        document.documentElement.scrollHeight - innerHeight,
        document.querySelector(".courtroom")!.scrollHeight -
          document.querySelector(".courtroom")!.clientHeight,
      ),
    ),
  ).toBeLessThanOrEqual(1);
});

test("phone layouts: fitting courts center while live content keeps faces anchored", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(url);
  await page.waitForFunction(() => !!window.presentation);
  await page.evaluate(() => window.presentation.ready);
  await expect(page.locator(".recovery-panel")).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  for (const [width, height] of [
    [360, 640],
    [390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    for (const name of ["invitation", "round-verdict"] as const) {
      await page.evaluate((name) => window.presentation.show(name), name);
      await expect
        .poll(() =>
          page.evaluate(() => {
            const court = document.querySelector(".courtroom")!,
              c = court.getBoundingClientRect(),
              cards = document
                .querySelector(".players")!
                .getBoundingClientRect(),
              content = document
                .querySelector(".court-lower-content")!
                .getBoundingClientRect();
            return Math.abs(
              cards.top -
                c.top -
                (c.bottom -
                  parseFloat(getComputedStyle(court).paddingBottom) -
                  content.bottom),
            );
          }),
        )
        .toBeLessThanOrEqual(2);
      if (name === "round-verdict")
        await expect(page.locator(".arena-heading")).toHaveCSS(
          "padding-bottom",
          "16px",
        );
    }
  }
  await page.evaluate(() => window.presentation.show("aligned-caption"));
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.querySelector(".caption-zone")!.getBoundingClientRect().top -
          document.querySelector(".center-stage")!.getBoundingClientRect()
            .bottom,
      ),
    )
    .toBe(16);
  const geometry = () =>
    page
      .locator(".face-picture")
      .evaluateAll((nodes) =>
        nodes.map((n) => n.getBoundingClientRect().toJSON()),
      );
  const before = await geometry();
  const videos = await page.locator(".face video").elementHandles();
  await page.getByRole("button", { name: "Mic & camera", exact: true }).focus();
  await page.evaluate(() =>
    window.presentation.update({
      judge: {
        id: "opening-line",
        epoch: 1,
        text: "New recognized text. ".repeat(100),
        status: "captions",
        startAt: null,
        expression: "neutral",
        targetPlayerId: "alex",
      },
    }),
  );
  await expect(page.locator(".caption-surface")).toContainText(
    "New recognized text.",
  );
  expect(await geometry()).toEqual(before);
  await expect(
    page.getByRole("button", { name: "Mic & camera", exact: true }),
  ).toBeFocused();
  for (const video of videos)
    expect(await video.evaluate((n) => n.isConnected)).toBe(true);
  await page.evaluate(() => window.presentation.show("missing-device"));
  const heading = page.locator(".recovery-panel h2");
  await expect(heading).toHaveText("Reconnect your mic and camera.");
  const title = await heading.boundingBox();
  expect(title!.height).toBeLessThan(24);
  expect(title!.width).toBeGreaterThanOrEqual(318);
  expect(
    (await page.locator(".recovery-panel > .icon").boundingBox())!.y + 28,
  ).toBeLessThanOrEqual(title!.y);
  // A notice arriving after centering reduces available space. The complete
  // ordinary task must still fit, without turning it into a continuation.
  await page.evaluate(() => window.presentation.show("notice"));
  await page.getByRole("button", { name: "Dismiss error" }).click();
  const lower = page.locator(".court-lower");
  await expect
    .poll(() => lower.evaluate((n) => n.scrollHeight - n.clientHeight))
    .toBe(0);
  await page.evaluate(() =>
    window.presentation.notice(
      "Your connection was briefly interrupted. Your turn is safe.",
    ),
  );
  await expect(page.locator(".room-notice")).toBeVisible();
  await expect
    .poll(() => lower.evaluate((n) => n.scrollHeight - n.clientHeight))
    .toBe(0);
  expect(
    await page
      .locator(".arena-heading")
      .evaluate((n) => n.scrollHeight - n.clientHeight),
  ).toBe(0);
  const stage = await page.locator(".center-stage").boundingBox();
  const boundary = await lower.boundingBox();
  expect(stage!.y + stage!.height).toBeLessThanOrEqual(
    boundary!.y + boundary!.height + 1,
  );
});
