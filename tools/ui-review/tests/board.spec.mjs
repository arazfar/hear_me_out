import { test as base, expect } from "@playwright/test";
import fs from "node:fs/promises";
import { startReview } from "./helpers.mjs";
const test = base.extend({
  review: async ({ context }, use) => {
    const app = await startReview();
    try {
      await use(app);
    } finally {
      await Promise.all(
        context.pages().map((page) => page.close({ runBeforeUnload: false })),
      );
      await app.dispose();
    }
  },
});
const open = async (page, review, hash = "") => {
  await page.goto(review.url + "/" + hash);
  await expect(page.locator("#app")).toBeVisible();
};
const feedback = async (review) =>
  (await fetch(review.url + "/api/feedback")).json();
const progress = async (review) =>
  (await fetch(review.url + "/api/progress")).json();
const viewed = async (review) => (await progress(review)).viewedCaptureIds;

test("guided navigation, history, flow resuming and unequal continuations", async ({
  page,
  review,
}) => {
  await open(page, review);
  await expect(page.locator("#flows button")).toHaveCount(7);
  await expect(page.locator("#comments")).toBeHidden();
  await expect(page.locator("#previous")).toBeDisabled();
  await page.locator("#next").click();
  await expect(page).toHaveURL(/screen=entry&viewport=phone&frame=0/);
  await page.locator("#next").click();
  await expect(page).toHaveURL(/screen=lobby&viewport=desktop&frame=0/);
  await page.goBack();
  await expect(page).toHaveURL(/screen=entry&viewport=phone&frame=0/);
  await page.goForward();
  await expect(page).toHaveURL(/screen=lobby&viewport=desktop&frame=0/);
  await page.locator("#flows button").filter({ hasText: "Gameplay" }).click();
  await page.locator("#next").click();
  await expect(page.locator(".pane-head").first()).toContainText(
    "Final image held",
  );
  await page.locator("#next").click();
  await expect(page).toHaveURL(/screen=turn&viewport=phone&frame=0/);
  await page.locator("#frame-select").selectOption("2");
  await expect(page.locator(".pane-head").first()).toContainText(
    "Final image held",
  );
  await page.locator("#flows button").filter({ hasText: "Lobby" }).click();
  await page.locator("#flows button").filter({ hasText: "Gameplay" }).click();
  await expect(page.locator("#frame-select")).toHaveValue("2");
  await page.reload();
  await expect(page.locator("#frame-select")).toHaveValue("2");
  await page.goto(review.url + "/#end=1");
  await expect(page.locator("#next")).toBeDisabled();
  await page.locator("#review-remaining").click();
  await expect(page.locator("#review")).toBeVisible();
});

test("automatic progress waits for decoded visible captures and retains legacy marks", async ({
  page,
  review,
}) => {
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  await page.route("**/images/desktop-after.png", async (route) => {
    await gate;
    await route.continue();
  });
  await open(page, review);
  await page.waitForTimeout(650);
  expect(await viewed(review)).toEqual([]);
  release();
  await expect(page.locator(".image-loading")).toHaveCount(0);
  await page.waitForTimeout(150);
  expect(await viewed(review)).toEqual([]);
  await expect.poll(() => viewed(review)).toHaveLength(2);
  await expect(page.locator("#desktop")).toHaveAccessibleName(
    "Desktop, reviewed",
  );
  await page.reload();
  await expect.poll(() => viewed(review)).toHaveLength(2);
  expect((await feedback(review)).reviewed["lobby:desktop"].value).toBe(true);
  await page.locator("#next").click();
  await expect.poll(() => viewed(review)).toHaveLength(4);
  await expect(page.locator("#state-progress")).toHaveText("2/2 sizes viewed");
  // All immutable captures are accounted for at completion; no legacy frame timestamps are fabricated.
  await fetch(review.url + "/api/progress", {
    method: "POST",
    headers: { Origin: review.url, "Content-Type": "application/json" },
    body: JSON.stringify({
      reviewId: review.manifest.id,
      viewedCaptureIds: review.manifest.captures.map((c) => c.id),
    }),
  });
  await page.goto(review.url + "/?complete=1#end=1");
  await expect(page.locator("#completion-title")).toHaveText("Review complete");
  await expect(page.locator("#overall")).toHaveText("8/8");
  await expect(page.locator("#review-remaining")).toBeHidden();
});

test("rapid skips, hidden documents, image errors and offscreen panes do not mark views", async ({
  page,
  review,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(document, "visibilityState", {
      get: () => (window.testHidden ? "hidden" : "visible"),
    });
    window.testHidden = true;
  });
  await open(page, review);
  await page.waitForTimeout(650);
  expect(await viewed(review)).toEqual([]);
  await page.evaluate(() => {
    window.testHidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.locator("#next").click();
  await page.locator("#next").click();
  await page.waitForTimeout(700);
  expect((await viewed(review)).some((id) => id.startsWith("entry:"))).toBe(
    false,
  );
  await page.route("**/images/desktop-after.png", (route) => route.abort());
  await page.goto(
    review.url + "/?image-failure=1#screen=topics&viewport=desktop",
  );
  await expect(page.locator(".image-error")).toBeVisible();
  await page.evaluate(() => {
    window.testHidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(650);
  expect((await viewed(review)).some((id) => id.startsWith("topics:"))).toBe(
    false,
  );
  await page.unroute("**/images/desktop-after.png");
  await page.locator(".image-error button").click();
  await expect
    .poll(async () =>
      (await viewed(review)).filter((id) => id.startsWith("topics:")),
    )
    .toHaveLength(2);
  await page.evaluate(() => {
    window.testHidden = true;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.goto(review.url + "/#screen=turn&viewport=phone");
  await page.locator("#add").click();
  await page.locator("#comments").evaluate((e) => {
    e.style.marginTop = "1800px";
    e.scrollIntoView();
  });
  await page.evaluate(() => {
    window.testHidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(700);
  expect((await viewed(review)).some((id) => id.startsWith("turn:"))).toBe(
    false,
  );
});

test("keyboard pins, empty drafts, editing, caret, exact attachments and tombstones", async ({
  page,
  review,
}) => {
  await open(page, review);
  await page.locator("#add").click();
  expect((await feedback(review)).comments).toHaveLength(3);
  await page.locator("#delete").click();
  expect((await feedback(review)).comments).toHaveLength(3);
  await page.locator(".viewport").last().focus();
  await page.keyboard.press("Enter");
  await page.locator("#comment-text").fill("Clearer spacing here");
  await expect
    .poll(async () => (await feedback(review)).comments.length)
    .toBe(4);
  const c = (await feedback(review)).comments.at(-1);
  expect(c.captureId).toBe("entry:desktop:after:0");
  expect(c.x).toBe(0.5);
  expect(c.y).toBe(0.5);
  await page
    .locator("#comment-text")
    .evaluate((e) => e.setSelectionRange(7, 7));
  await page.waitForTimeout(650);
  expect(
    await page.locator("#comment-text").evaluate((e) => e.selectionStart),
  ).toBe(7);
  await expect(page.locator("#comment-text")).toBeFocused();
  await page.locator(`.pin[data-pin="${c.id}"]`).focus();
  await page.keyboard.press("ArrowRight");
  await expect
    .poll(async () => (await feedback(review)).comments.at(-1).x)
    .toBe(0.51);
  await page.locator("#actual").click();
  expect(
    await page.locator(`.pin[data-pin="${c.id}"]`).evaluate((p) => {
      const r = p.getBoundingClientRect(),
        s = p.parentElement.getBoundingClientRect();
      return (r.x + r.width / 2 - s.x) / s.width;
    }),
  ).toBeCloseTo(0.51, 3);
  await page.locator("#resolve").click();
  await expect
    .poll(async () => (await feedback(review)).comments.at(-1).resolved)
    .toBe(true);
  await page.locator("#resolve").click();
  await expect
    .poll(async () => (await feedback(review)).comments.at(-1).resolved)
    .toBe(false);
  await page.locator("#delete").click();
  await expect
    .poll(async () => (await feedback(review)).comments.at(-1).deleted)
    .toBe(true);
  expect((await feedback(review)).comments[0].text).toBe(""); // Existing empty comment survives.
});

test("failed writes preserve drafts, exports and progress across navigation and reload", async ({
  page,
  review,
}) => {
  let fail = true;
  await page.route("**/api/*", (route) =>
    route.request().method() === "POST" && fail
      ? route.fulfill({ status: 503, body: "{}" })
      : route.continue(),
  );
  await open(page, review);
  await page.locator("#add").click();
  await page.locator("#comment-text").fill("Offline draft");
  await expect(page.locator("#retry")).toBeVisible();
  await page.locator("#next").click();
  await expect(page.locator("#comment-text")).toHaveValue("Offline draft");
  await page.locator("#more summary").first().click();
  const download = page.waitForEvent("download");
  await page.locator("#export-json").click();
  const exported = JSON.parse(
    await fs.readFile(await (await download).path(), "utf8"),
  );
  expect(exported.dirty).toBe(true);
  expect(exported.comments.at(-1).text).toBe("Offline draft");
  expect(exported.unsavedDrafts.length).toBeGreaterThan(0);
  // The old storage key is the compatibility contract; reload must restore without a successful POST.
  const draft = await page.evaluate(
    (id) => JSON.parse(localStorage.getItem("hmo-review:" + id)),
    review.manifest.id,
  );
  expect(draft.dirty).toBe(true);
  page.on("dialog", (dialog) => dialog.accept());
  await page.reload();
  await expect(page.locator("#app")).toBeVisible();
  await page.locator("#comments-toggle").click();
  await expect(
    page.locator(".comment-card").filter({ hasText: "Offline draft" }),
  ).toBeVisible();
  fail = false;
  await page.locator("#retry").click();
  await expect
    .poll(async () => (await feedback(review)).comments.at(-1).text)
    .toBe("Offline draft");
  await expect(page.locator("#save-status")).toHaveText("Saved");
  expect((await viewed(review)).length).toBeGreaterThan(0);
});

test("late responses cannot overwrite newer text", async ({ page, review }) => {
  await open(page, review);
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  let first = true;
  await page.route("**/api/feedback", async (route) => {
    if (route.request().method() === "POST" && first) {
      first = false;
      await gate;
    }
    await route.continue();
  });
  await page.locator("#add").click();
  await page.locator("#comment-text").fill("Earlier edit");
  await expect.poll(() => first).toBe(false);
  await page.locator("#comment-text").fill("Newer edit");
  release();
  await expect
    .poll(async () => (await feedback(review)).comments.at(-1)?.text)
    .toBe("Newer edit");
  await expect(page.locator("#comment-text")).toHaveValue("Newer edit");
});

test("progress queues merge across tabs, restore after reload and never warn on unload", async ({
  page,
  context,
  review,
}) => {
  let fail = true;
  await context.route("**/api/progress", (route) =>
    route.request().method() === "POST" && fail
      ? route.fulfill({ status: 503, body: "{}" })
      : route.continue(),
  );
  await open(page, review);
  await expect(page.locator("#retry")).toBeVisible();
  expect(
    await page.evaluate(() => {
      const e = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    }),
  ).toBe(false);
  const originalURL = page.url(),
    other = await context.newPage();
  await open(other, review, "#screen=shared&viewport=phone");
  await other.bringToFront();
  await expect(other.locator("#retry")).toBeVisible();
  await expect
    .poll(() =>
      other.evaluate(
        (id) =>
          JSON.parse(localStorage.getItem("hmo-progress:" + id))
            .viewedCaptureIds,
        review.manifest.id,
      ),
    )
    .toContain("shared:phone:after:0");
  const queued = await other.evaluate(
    (id) =>
      JSON.parse(localStorage.getItem("hmo-progress:" + id)).viewedCaptureIds,
    review.manifest.id,
  );
  expect(queued).toContain("entry:desktop:before:0");
  expect(queued).toContain("shared:phone:after:0");
  expect(page.url()).toBe(originalURL);
  fail = false;
  await other.reload();
  await expect
    .poll(async () => {
      const ids = await viewed(review);
      return queued.every((id) => ids.includes(id));
    })
    .toBe(true);
  await other.close();
});

test("failed initial reads and unavailable storage are explicit and non-destructive", async ({
  page,
  review,
}) => {
  const before = await feedback(review);
  await page.route("**/api/feedback", (route) =>
    route.fulfill({ status: 503, body: "{}" }),
  );
  await page.goto(review.url);
  await expect(page.locator("#load-error")).toBeVisible();
  await expect(page.locator("#app")).toBeHidden();
  expect(await feedback(review)).toEqual(before);
  await page.unroute("**/api/feedback");
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => {
      throw new DOMException("blocked", "SecurityError");
    };
    Storage.prototype.setItem = () => {
      throw new DOMException("blocked", "SecurityError");
    };
  });
  await page.reload();
  await expect(page.locator("#app")).toBeVisible();
  await page.locator("#add").click();
  await page.locator("#comment-text").fill("Storage unavailable note");
  await expect
    .poll(async () => (await feedback(review)).comments.at(-1).text)
    .toBe("Storage unavailable note");
  await expect(page.locator("#save-status")).toContainText(
    "storage unavailable",
  );
});

test("Fit, linked/independent panning and narrow comment layout", async ({
  page,
  review,
}, testInfo) => {
  await open(page, review);
  await page.locator("#actual").click();
  const panes = page.locator(".viewport");
  await panes.first().evaluate((e) => {
    e.scrollLeft = 180;
    e.scrollTop = 90;
  });
  await expect
    .poll(() => panes.last().evaluate((e) => e.scrollLeft))
    .toBeCloseTo(180, 0);
  await page.locator("#more summary").first().click();
  await page.locator("#linked").uncheck();
  await page.keyboard.press("Escape");
  const prior = await panes.last().evaluate((e) => e.scrollLeft);
  await panes.first().evaluate((e) => (e.scrollLeft = 260));
  await page.waitForTimeout(100);
  expect(await panes.last().evaluate((e) => e.scrollLeft)).toBe(prior);
  await page.locator("#fit").click();
  for (const pane of await panes.all())
    expect(
      await pane.evaluate(
        (e) =>
          e.scrollWidth <= e.clientWidth + 1 &&
          e.scrollHeight <= e.clientHeight + 1,
      ),
    ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 700, height: 1000 });
  await page.locator("#phone").click();
  await page.locator("#add").click();
  await page.locator("#comment-text").fill("Narrow window feedback");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(
    await page
      .locator("#comment-text")
      .evaluate((e) => parseFloat(getComputedStyle(e).fontSize)),
  ).toBeGreaterThanOrEqual(16);
  const aside = await page.locator("#comments").boundingBox(),
    images = await page.locator("#comparison").boundingBox();
  expect(aside.y).toBeGreaterThan(images.y + images.height);
  await page.screenshot({
    path: testInfo.outputPath("narrow.png"),
    fullPage: true,
  });
});

test("actual background-tab visibility cancels viewing @focus", async ({
  page,
  context,
  review,
}) => {
  await open(page, review);
  const foreground = await context.newPage();
  await open(foreground, review);
  await (
    await context.newCDPSession(page)
  ).send("Emulation.setFocusEmulationEnabled", { enabled: false });
  await (
    await context.newCDPSession(foreground)
  ).send("Emulation.setFocusEmulationEnabled", { enabled: false });
  await foreground.bringToFront();
  await page.evaluate(() => (location.hash = "screen=shared&viewport=phone"));
  expect(await page.evaluate(() => document.hasFocus())).toBe(false);
  await page.waitForTimeout(750);
  expect((await viewed(review)).some((id) => id.startsWith("shared:"))).toBe(
    false,
  );
  await page.bringToFront();
  await expect
    .poll(async () =>
      (await viewed(review)).filter((id) => id.startsWith("shared:")),
    )
    .toHaveLength(2);
  await foreground.close();
});
