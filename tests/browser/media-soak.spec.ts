import { expect, test, type BrowserContext, type Page } from "@playwright/test";

type MediaResources = {
  tracks: MediaStreamTrack[];
  contexts: AudioContext[];
  sockets: WebSocket[];
  peers: RTCPeerConnection[];
  worklets: { name: string; retired: boolean }[];
};

declare global {
  interface Window {
    courtResources: MediaResources;
  }
}

async function observeMedia(context: BrowserContext) {
  await context.addInitScript(() => {
    const resources: MediaResources = {
      tracks: [],
      contexts: [],
      sockets: [],
      peers: [],
      worklets: [],
    };
    Object.assign(window, { courtResources: resources });
    const acquire = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    );
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await acquire(constraints);
      resources.tracks.push(...stream.getTracks());
      return stream;
    };
    window.AudioContext = class extends AudioContext {
      constructor(...args: ConstructorParameters<typeof AudioContext>) {
        super(...args);
        resources.contexts.push(this);
      }
    };
    window.AudioWorkletNode = class extends AudioWorkletNode {
      constructor(...args: ConstructorParameters<typeof AudioWorkletNode>) {
        super(...args);
        const record = { name: args[1], retired: false };
        resources.worklets.push(record);
        this.port.addEventListener("message", ({ data }) => {
          if (data.type === "retired") record.retired = true;
        });
      }
    };
    window.WebSocket = class extends WebSocket {
      constructor(...args: ConstructorParameters<typeof WebSocket>) {
        super(...args);
        resources.sockets.push(this);
      }
    };
    window.RTCPeerConnection = class extends RTCPeerConnection {
      constructor(...args: ConstructorParameters<typeof RTCPeerConnection>) {
        super(...args);
        resources.peers.push(this);
      }
    };
  });
}

async function resources(page: Page) {
  return page.evaluate(() => {
    const r = window.courtResources;
    return {
      liveTracks: r.tracks.filter((t) => t.readyState === "live").length,
      openAudio: r.contexts.filter((a) => a.state !== "closed").length,
      openSockets: r.sockets.filter((s) => s.readyState !== WebSocket.CLOSED)
        .length,
      openPeers: r.peers.filter((p) => p.connectionState !== "closed").length,
      processors: r.worklets.filter((w) => !w.retired).length,
      seat: sessionStorage.getItem("hmo-seat") !== null,
    };
  });
}

test("media resources are released after leaving and rejoining courts", async ({
  browser,
  baseURL,
  request,
}, info) => {
  const cycles = Number(process.env.MEDIA_SOAK_CYCLES || 1);
  if (!Number.isInteger(cycles) || cycles < 1)
    throw Error("MEDIA_SOAK_CYCLES must be a positive integer");
  test.setTimeout(cycles * 70000 + 30000);
  await request.post("/__test/reset");
  const contexts = await Promise.all(
    [0, 1].map(() =>
      browser.newContext({
        permissions: ["camera", "microphone"],
        viewport: { width: 1280, height: 720 },
      }),
    ),
  );
  const results: unknown[] = [];
  try {
    await Promise.all(contexts.map(observeMedia));
    const pages = await Promise.all(contexts.map((c) => c.newPage()));
    const [a, b] = pages;
    for (const page of pages) page.setDefaultTimeout(30000);
    const created: number[] = [];
    await Promise.all(
      pages.map((p, i) =>
        p
          .goto(baseURL!)
          .then(() =>
            p.getByLabel("Your name", { exact: true }).fill(i ? "Sam" : "Alex"),
          ),
      ),
    );
    await b.getByRole("button", { name: "Join a friend" }).click();
    for (let cycle = 1; cycle <= cycles; cycle++) {
      // The live entry path allows three room reservations per minute per address.
      if (created.length === 3) {
        const remaining = created.shift()! + 61000 - Date.now();
        if (remaining > 0) await a.waitForTimeout(remaining);
      }
      const [reservation] = await Promise.all([
        a.waitForResponse(
          (response) =>
            new URL(response.url()).pathname === "/api/rooms" &&
            response.request().method() === "POST",
        ),
        a.getByRole("button", { name: "Create room", exact: true }).click(),
      ]);
      expect(reservation.ok()).toBe(true);
      created.push(Date.now());
      const code = (
        await a.locator(".room-code b, .invite-code span").innerText()
      ).trim();
      await b.getByLabel("Room code").fill(code);
      await b.getByRole("button", { name: "Join room", exact: true }).click();
      for (const p of pages)
        await expect(
          p.getByRole("button", { name: "Ready to argue" }),
        ).toBeEnabled();
      if (info.project.name === "relay") {
        for (const page of pages) {
          const canvas = page.locator(".face-picture canvas:not([hidden])");
          await expect(canvas).toBeVisible();
          const pixels = () =>
            canvas.evaluate((element: HTMLCanvasElement) => {
              const { data } = element
                .getContext("2d")!
                .getImageData(0, 0, element.width, element.height);
              let hash = 1;
              for (let index = 0; index < data.length; index += 4)
                hash = Math.imul(hash ^ data[index], 16777619);
              return hash;
            });
          const first = await pixels();
          await expect.poll(pixels).not.toBe(first);
        }
      }
      for (const page of pages)
        await expect(page.locator(".stage[data-quality] canvas")).toBeVisible();
      const acquired = await Promise.all(pages.map(resources));
      for (const r of acquired) {
        expect(r.liveTracks).toBe(2);
        expect(r.openAudio).toBe(1);
        expect(r.processors).toBe(3);
        expect(r.openSockets).toBeGreaterThanOrEqual(3);
      }
      if (cycle === 2) {
        await a.evaluate(() =>
          window.courtResources.contexts.at(-1)!.suspend(),
        );
      }
      for (const p of pages) {
        await p.getByRole("button", { name: "Leave", exact: true }).click();
        await expect(p.getByLabel("Your name", { exact: true })).toBeVisible();
        await expect
          .poll(() => resources(p))
          .toEqual({
            liveTracks: 0,
            openAudio: 0,
            processors: 0,
            openSockets: 0,
            openPeers: 0,
            seat: false,
          });
      }
      const serverCounts = async () => {
        const health = await (await request.get("/healthz")).json();
        return health.rooms.reduce(
          (count: number, r: { players: number; sttConnections: number }) =>
            count + r.players + r.sttConnections,
          0,
        );
      };
      await expect.poll(serverCounts).toBe(0);
      const retained = await Promise.all(
        pages.map(async (page, i) => {
          // Release the test's own references before accounting for reachable heap.
          await page.evaluate(() => {
            const r = window.courtResources;
            for (const list of Object.values(r)) list.length = 0;
          });
          // A DOM agent assigns IDs to detached nodes that it observes. Use a fresh
          // agent after GC on every observation so the test cannot retain its own samples.
          let sample = { jsHeapBytes: 0, documents: 0, nodes: 0 };
          await expect
            .poll(async () => {
              const session = await contexts[i].newCDPSession(page);
              try {
                await session.send("HeapProfiler.collectGarbage");
                const { usedSize } = await session.send("Runtime.getHeapUsage");
                const { documents, nodes } = await session.send(
                  "Memory.getDOMCounters",
                );
                sample = { jsHeapBytes: usedSize, documents, nodes };
                await session.send("DOM.enable");
                const { detachedNodes } = await session.send(
                  "DOM.getDetachedDomNodes",
                );
                return detachedNodes.filter(({ treeNode }) => {
                  const attrs = treeNode.attributes || [];
                  const cls = attrs.indexOf("class");
                  return (
                    cls >= 0 &&
                    /(?:^| )(room-scroll|title-layout|stage)(?: |$)/.test(
                      attrs[cls + 1],
                    )
                  );
                }).length;
              } finally {
                await session.detach();
              }
            })
            .toBe(0);
          return sample;
        }),
      );
      results.push({ cycle, acquired, retained });
    }
  } finally {
    await info.attach("media-soak", {
      body: Buffer.from(JSON.stringify(results)),
      contentType: "application/json",
    });
    await Promise.all(contexts.map((c) => c.close()));
  }
});
