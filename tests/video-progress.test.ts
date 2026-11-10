import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { Client } from "../src/game/client";
import type { Snapshot } from "../shared/domain";
import { encodeVideo } from "../shared/media";

test("a delayed frame callback cannot count a cached decoder frame twice", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const saved = Object.getOwnPropertyDescriptor(globalThis, "document");
  let decoded = 0;
  const videos: { callback?: VideoFrameRequestCallback }[] = [];
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      createElement: (tag: string) => {
        if (tag === "canvas") return { getContext: () => ({}) };
        const video = {
          callback: undefined as VideoFrameRequestCallback | undefined,
          play: async () => {},
          getVideoPlaybackQuality: () => ({ totalVideoFrames: decoded }),
          requestVideoFrameCallback: (callback: VideoFrameRequestCallback) => {
            video.callback = callback;
          },
        };
        videos.push(video);
        return video;
      },
    },
  });
  t.after(() => {
    if (saved) Object.defineProperty(globalThis, "document", saved);
    else Reflect.deleteProperty(globalThis, "document");
  });
  const client = new Client();
  client.capture.stream = {} as MediaStream;
  client.video.prepareVideo();
  t.mock.timers.tick(100);
  assert.equal(client.video.localFrames, 0, "an empty preview is not a frame");
  decoded = 1;
  t.mock.timers.tick(100);
  assert.equal(client.video.localFrames, 1);
  t.mock.timers.tick(1100);
  videos[0].callback!(0, { presentedFrames: 1 } as VideoFrameCallbackMetadata);
  assert.equal(
    client.video.localFrames,
    1,
    "late callback repeats the same frame",
  );
  decoded = 2;
  t.mock.timers.tick(100);
  assert.equal(
    client.video.localFrames,
    2,
    "offscreen decoder progress counts",
  );
  client.video.prepareVideo();
  t.mock.timers.tick(100);
  const recreated = client.video.localFrames;
  t.mock.timers.tick(1100);
  videos[0].callback!(0, { presentedFrames: 10 } as VideoFrameCallbackMetadata);
  videos[1].callback!(0, { presentedFrames: 1 } as VideoFrameCallbackMetadata);
  assert.equal(
    client.video.localFrames,
    recreated,
    "obsolete and cached callbacks cannot advance the new preview",
  );
  // Browsers without decoder totals still use actual presentation callbacks.
  Object.assign(videos[1], { getVideoPlaybackQuality: undefined });
  videos[1].callback!(0, { presentedFrames: 3 } as VideoFrameCallbackMetadata);
  assert.equal(client.video.localFrames, recreated + 1);
});

test("failed or obsolete camera Blob reads are discarded and the encoder can retry", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const saved = Object.getOwnPropertyDescriptor(globalThis, "document");
  const savedReader = Object.getOwnPropertyDescriptor(globalThis, "FileReader");
  class Reader {
    result: ArrayBuffer | null = null;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    aborted = false;
    readAsArrayBuffer(blob: Blob) {
      void blob.arrayBuffer().then(
        (data) => {
          if (this.aborted) return;
          this.result = data;
          this.onload?.();
        },
        () => {
          if (!this.aborted) this.onerror?.();
        },
      );
    }
    abort() {
      this.aborted = true;
      this.onabort?.();
    }
  }
  Object.defineProperty(globalThis, "FileReader", {
    configurable: true,
    value: Reader,
  });
  const callbacks: ((blob: Blob) => Promise<void>)[] = [];
  const doc = {
    hidden: false,
    createElement: (tag: string) =>
      tag === "canvas"
        ? {
            getContext: () => ({ drawImage: () => {} }),
            toBlob: (callback: (blob: Blob) => Promise<void>) =>
              callbacks.push(callback),
          }
        : {
            readyState: 2,
            play: async () => {},
            getVideoPlaybackQuality: () => ({ totalVideoFrames: 1 }),
          },
  };
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: doc,
  });
  t.after(() => {
    if (saved) Object.defineProperty(globalThis, "document", saved);
    else Reflect.deleteProperty(globalThis, "document");
    if (savedReader)
      Object.defineProperty(globalThis, "FileReader", savedReader);
    else Reflect.deleteProperty(globalThis, "FileReader");
  });
  const client = new Client();
  let sent = 0;
  client.capture.stream = {} as MediaStream;
  client.state = { mediaMode: "wss", mediaEpoch: 1 } as Snapshot;
  client.sockets.set("video", {
    readyState: WebSocket.OPEN,
    bufferedAmount: 0,
    send: () => sent++,
  } as unknown as WebSocket);
  client.video.prepareVideo();
  t.mock.timers.tick(100);
  await assert.doesNotReject(
    callbacks.shift()!(
      Object.assign(new Blob(), {
        arrayBuffer: async () => {
          throw new DOMException("expired", "NotReadableError");
        },
      }),
    ),
  );
  assert.equal(sent, 0);
  t.mock.timers.tick(100);
  doc.hidden = true;
  let read = false;
  await callbacks.shift()!(
    Object.assign(new Blob(), {
      arrayBuffer: async () => {
        read = true;
        return new ArrayBuffer(1);
      },
    }),
  );
  assert.equal(
    read,
    false,
    "a hidden/closing document cannot start a Blob read",
  );
  doc.hidden = false;
  t.mock.timers.tick(100);
  await callbacks.shift()!(new Blob([new Uint8Array([1, 2, 3])]));
  assert.equal(
    sent,
    1,
    "a failed frame must release the encoder for the next one",
  );
  t.mock.timers.tick(100);
  let finishRead!: (data: ArrayBuffer) => void;
  const pending = callbacks.shift()!(
    Object.assign(new Blob(), {
      arrayBuffer: () =>
        new Promise<ArrayBuffer>((resolve) => {
          finishRead = resolve;
        }),
    }),
  );
  client.video.setPageActive(false);
  await pending;
  finishRead(new ArrayBuffer(3));
  await Promise.resolve();
  assert.equal(
    sent,
    1,
    "navigation cancels an in-flight read without sending it",
  );
  t.mock.timers.tick(100);
  assert.equal(
    callbacks.length,
    0,
    "a still-visible navigating page stops encoding",
  );
  client.video.setPageActive(true);
  t.mock.timers.tick(100);
  client.video.resetVideo();
  read = false;
  await callbacks.shift()!(
    Object.assign(new Blob(), {
      arrayBuffer: async () => {
        read = true;
        return new ArrayBuffer(3);
      },
    }),
  );
  assert.equal(
    read,
    false,
    "obsolete encode callbacks cannot begin Blob reads",
  );
  t.mock.timers.tick(100);
  await callbacks.shift()!(new Blob([new Uint8Array([1, 2, 3])]));
  assert.equal(sent, 2, "capture can continue after foreground restoration");
});

function decodeFixture(t: TestContext) {
  const decoded: { blob: Blob; finish: () => void; fail: () => void }[] = [];
  const acknowledgements: unknown[] = [];
  let closed = 0,
    drawn = 0,
    cleared = 0;
  const doc = {
    hidden: false,
    createElement: () => ({
      width: 256,
      height: 144,
      getContext: () => ({
        drawImage: () => drawn++,
        clearRect: () => cleared++,
      }),
    }),
  };
  for (const [key, value] of Object.entries({
    document: doc,
    createImageBitmap: (blob: Blob) =>
      new Promise((resolve, reject) => {
        decoded.push({
          blob,
          finish: () =>
            resolve({
              width: 256,
              height: 144,
              close: () => closed++,
            }),
          fail: () => reject(new Error("JPEG could not be decoded")),
        });
      }),
  })) {
    const saved = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, configurable: true });
    t.after(() => {
      if (saved) Object.defineProperty(globalThis, key, saved);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
  const client = new Client();
  client.state = { mediaMode: "wss", mediaEpoch: 7 } as Snapshot;
  client.video.captureGeneration = 2;
  client.send = (message) => void acknowledgements.push(message);
  return {
    client,
    video: client.video,
    doc,
    decoded,
    acknowledgements,
    counts: () => ({ closed, drawn, cleared }),
    frame: (
      seq: number,
      {
        probe = false,
        epoch = 7,
        generation = 2,
        capturedAt = Date.now(),
      } = {},
    ) =>
      encodeVideo(
        epoch,
        seq,
        capturedAt,
        new Uint8Array([0xff, 0xd8, seq, 0xff, 0xd9]),
        probe,
        generation,
      ).buffer,
  };
}

test("video ingress validates packets and still accepts camera probes in RTC mode", async (t) => {
  const f = decodeFixture(t);
  f.client.state!.mediaMode = "rtc";
  const ignored = [
    f.frame(1, { probe: true }).slice(0, -1),
    f.frame(2, { probe: true, epoch: 6 }),
    f.frame(3, { probe: true, generation: 1 }),
    f.frame(4),
  ].map((frame) => f.video.receive(frame));
  assert.equal(f.decoded.length, 0);
  await Promise.all(ignored);
  assert.deepEqual(f.acknowledgements, []);

  const probe = f.video.receive(f.frame(5, { probe: true }));
  f.decoded[0].finish();
  await probe;
  assert.deepEqual(f.acknowledgements, [
    { type: "video_ack", probe: true, seq: 5, mediaEpoch: 7 },
  ]);
  assert.deepEqual(f.counts(), { closed: 1, drawn: 0, cleared: 0 });
});

test("a probe that finishes after camera replacement closes without a receipt", async (t) => {
  const f = decodeFixture(t);
  const obsolete = f.video.receive(f.frame(1, { probe: true }));
  assert.equal(f.decoded.length, 1);
  const generation = ++f.video.captureGeneration;
  f.decoded[0].finish();
  await obsolete;
  assert.equal(f.counts().closed, 1);
  assert.deepEqual(f.acknowledgements, []);

  const fresh = f.video.receive(f.frame(2, { probe: true, generation }));
  f.decoded[1].finish();
  await fresh;
  assert.deepEqual(f.acknowledgements, [
    { type: "video_ack", probe: true, seq: 2, mediaEpoch: 7 },
  ]);
  assert.deepEqual(f.counts(), { closed: 2, drawn: 0, cleared: 0 });
});

test("relay video coalesces queued frames and discards old epochs", async (t) => {
  const f = decodeFixture(t);
  const first = f.video.receive(f.frame(1, { capturedAt: Date.now() - 5000 }));
  assert.equal(
    f.decoded.length,
    1,
    "the first valid relay packet starts decoding",
  );
  const second = f.video.receive(f.frame(2));
  const latest = f.video.receive(f.frame(3));
  assert.equal(f.decoded.length, 1, "only one relay frame decodes at a time");

  f.decoded[0].finish();
  await Promise.resolve();
  assert.equal(f.decoded.length, 2, "the latest queued frame starts next");
  const payloads = await Promise.all(
    f.decoded.map(async ({ blob }) => [
      ...new Uint8Array(await blob.arrayBuffer()),
    ]),
  );
  assert.deepEqual(payloads, [
    [0xff, 0xd8, 1, 0xff, 0xd9],
    [0xff, 0xd8, 3, 0xff, 0xd9],
  ]);
  f.decoded[1].finish();
  await Promise.resolve();
  assert.equal(f.decoded.length, 2, "the superseded frame never decodes");
  await Promise.all([first, second, latest]);

  const obsolete = f.video.receive(f.frame(4));
  assert.equal(f.decoded.length, 3);
  f.client.state!.mediaEpoch++;
  f.decoded[2].finish();
  await obsolete;
  assert(f.video.remoteFrame);
  assert.equal(f.video.remoteFrameSeq, 3);
  assert.deepEqual(f.acknowledgements, [
    { type: "video_ack", seq: 1, mediaEpoch: 7 },
    { type: "video_ack", seq: 3, mediaEpoch: 7 },
  ]);
  assert.deepEqual(f.counts(), { closed: 3, drawn: 2, cleared: 0 });
});

test("a failed relay decode keeps the last good frame and sends no receipt", async (t) => {
  const f = decodeFixture(t);
  const first = f.video.receive(f.frame(1));
  f.decoded[0].finish();
  await first;

  const broken = f.video.receive(f.frame(2));
  f.decoded[1].fail();
  await broken;
  assert(f.video.remoteFrame);
  assert.equal(f.video.remoteFrameSeq, 1);
  assert.deepEqual(f.acknowledgements, [
    { type: "video_ack", seq: 1, mediaEpoch: 7 },
  ]);
  assert.deepEqual(f.counts(), { closed: 1, drawn: 1, cleared: 0 });
});

test("hidden or navigating documents discard relay frames and probes before creating Blobs", async (t) => {
  const f = decodeFixture(t);
  f.video.setPageActive(false);
  await f.video.receive(f.frame(1));
  await f.video.receive(f.frame(2, { probe: true }));
  assert.equal(f.decoded.length, 0, "beforeunload precedes document.hidden");
  f.video.setPageActive(true);
  f.doc.hidden = true;
  await f.video.receive(f.frame(3));
  await f.video.receive(f.frame(4, { probe: true }));
  assert.equal(f.decoded.length, 0);
  assert.deepEqual(f.acknowledgements, []);
});

test("page restoration accepts fresh video but never renders or acknowledges obsolete decodes", async (t) => {
  const f = decodeFixture(t);
  const receiving = f.video.receive(f.frame(1));
  const probing = f.video.receive(f.frame(2, { probe: true }));
  await f.video.receive(f.frame(3));
  f.video.setPageActive(false);
  f.video.setPageActive(true);
  f.decoded.forEach((decode) => decode.finish());
  await Promise.all([receiving, probing]);
  assert.deepEqual(f.counts(), { closed: 2, drawn: 0, cleared: 0 });
  assert.equal(f.decoded.length, 2, "navigation drops the queued frame too");
  assert.deepEqual(f.acknowledgements, []);
  const fresh = f.video.receive(f.frame(4));
  f.decoded[2].finish();
  await fresh;
  const freshProbe = f.video.receive(f.frame(5, { probe: true }));
  f.decoded[3].finish();
  await freshProbe;
  assert.deepEqual(f.counts(), { closed: 4, drawn: 1, cleared: 0 });
  assert.deepEqual(f.acknowledgements, [
    { type: "video_ack", seq: 4, mediaEpoch: 7 },
    { type: "video_ack", probe: true, seq: 5, mediaEpoch: 7 },
  ]);
});
