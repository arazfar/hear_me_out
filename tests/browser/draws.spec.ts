import { test, expect } from "@playwright/test";
import { syntheticMicrophone } from "./synthetic-media";
import type { Snapshot } from "../../shared/domain";

test("phone layouts: shared draws, rematches, and departure preserve the outcome", async ({
  browser,
  baseURL,
  request,
}, info) => {
  await request.post("/__test/reset");
  const webkit = info.project.name.startsWith("webkit");
  const second = webkit
    ? await browser.browserType().launch({ headless: true })
    : null;
  const contexts = await Promise.all(
    [browser, second || browser].map((b) =>
      b.newContext({
        viewport: { width: 390, height: 844 },
        permissions: ["camera", "microphone"],
      }),
    ),
  );
  if (webkit)
    await Promise.all(
      contexts.map((context, index) =>
        syntheticMicrophone(context, index ? 550 : 330),
      ),
    );
  const [a, b] = await Promise.all(contexts.map((c) => c.newPage()));
  const errors: string[] = [];
  for (const page of [a, b])
    page.on("pageerror", (e) => errors.push(e.message));
  try {
    await a.goto(baseURL!);
    await a.getByLabel("Your name", { exact: true }).fill("Alex");
    await a.getByRole("button", { name: "Create room", exact: true }).click();
    await expect(a.locator(".invite-code span")).toBeVisible();
    const code = (await a.locator(".invite-code span").innerText()).trim();
    await b.goto(baseURL + "/?room=" + code);
    await b.getByLabel("Your name", { exact: true }).fill("Sam");
    await b.getByRole("button", { name: "Join room", exact: true }).click();
    for (const page of [a, b])
      await expect(
        page.getByRole("button", { name: "Ready to argue", exact: true }),
      ).toBeEnabled();
    const base: Snapshot = await (
      await request.post("/__test/state/" + code)
    ).json();
    const [p0, p1] = base.players;
    const draw = {
      round: 2,
      roundId: "draw-round",
      winnerId: null,
      scores: { [p0.id]: 24, [p1.id]: 24 },
      reason: "The round scores are equal, so both players earn a win.",
    };
    const present = async (phase: "ROUND_RESOLVE" | "MATCH_RESULT") => {
      const r = await request.post("/__test/present/" + code, {
        data: {
          phase,
          matchId: "draw-match",
          round: 2,
          roundId: "draw-round",
          turn: null,
          judge: null,
          phaseDeadline: Date.now() + 60000,
          winnerId: null,
          results: [draw],
          rematchReady: [],
          players: base.players.map((p) => ({
            ...p,
            wins: phase === "MATCH_RESULT" ? 2 : 1,
            scoreUnits: 24,
          })),
        },
      });
      expect(r.ok()).toBe(true);
    };
    await present("ROUND_RESOLVE");
    for (const page of [a, b])
      await expect(page.locator(".result-panel h2")).toHaveText("Round tied!");
    await present("MATCH_RESULT");
    for (const page of [a, b]) {
      await expect(page.locator(".result-panel h2")).toHaveText("It’s a draw!");
      await expect(page.locator(".match-score")).toHaveText("2–2");
      await expect(
        page
          .getByRole("button", { name: "Rematch", exact: true })
          .locator('.icon[aria-hidden="true"]'),
      ).toHaveCount(1);
      await expect(
        page.getByRole("img", { name: "2 of 2 round wins", exact: true }),
      ).toHaveCount(2);
      await expect(
        page.getByRole("img", { name: "Voice activity", exact: true }),
      ).toHaveCount(2);
      await expect(page.locator(".verdict-reason,.tie-break")).toHaveCount(0);
      for (const size of [
        { width: 360, height: 640 },
        { width: 390, height: 844 },
      ]) {
        await page.setViewportSize(size);
        const box = await page
          .getByRole("button", { name: "Rematch", exact: true })
          .boundingBox();
        const dock = await page.locator(".control-row").boundingBox();
        expect(box!.y + box!.height).toBeLessThanOrEqual(dock!.y);
        expect(
          await page
            .locator(".room-scroll")
            .evaluate((n) => n.scrollHeight - n.clientHeight),
        ).toBeLessThanOrEqual(1);
      }
    }
    await a.getByRole("button", { name: "Rematch", exact: true }).click();
    await b.getByRole("button", { name: "Rematch", exact: true }).click();
    await expect
      .poll(
        async () =>
          (
            (await (
              await request.post("/__test/state/" + code)
            ).json()) as Snapshot
          ).phase,
      )
      .toBe("INTRO_COIN");
    const next: Snapshot = await (
      await request.post("/__test/state/" + code)
    ).json();
    expect(next.players.map((p) => p.wins)).toEqual([0, 0]);
    expect(next.results).toEqual([]);
    await present("MATCH_RESULT");
    await b.getByRole("button", { name: "Leave", exact: true }).click();
    await expect(
      a.getByRole("button", { name: "Back to menu", exact: true }),
    ).toBeVisible();
    await expect(a.locator(".result-panel h2")).toHaveText("It’s a draw!");
    await expect(a.locator(".match-score")).toHaveText("2–2");
    const departed: Snapshot = await (
      await request.post("/__test/state/" + code)
    ).json();
    expect(departed.phase).toBe("MATCH_RESULT");
    expect(departed.winnerId).toBeNull();
    expect(departed.results[0].winnerId).toBeNull();
    expect(errors).toEqual([]);
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
    await second?.close();
  }
});
