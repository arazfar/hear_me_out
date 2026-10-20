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
  const decoded: { finish: () => void }[] = [];
  let closed = 0,
    drawn = 0,
    acknowledgements = 0;
  const doc = {
    hidden: false,
    createElement: () => ({
      width: 256,
      height: 144,
      getContext: () => ({ drawImage: () => drawn++, clearRect: () => {} }),
    }),
  };
  for (const [key, value] of Object.entries({
    document: doc,
    createImageBitmap: () =>
      new Promise((resolve) => {
        decoded.push({
          finish: () =>
            resolve({
              width: 256,
              height: 144,
              close: () => closed++,
            }),
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
  client.send = () => {
    acknowledgements++;
  };
  return {
    video: client.video,
    doc,
    decoded,
    counts: () => ({ closed, drawn, acknowledgements }),
    frame: (seq: number, probe = false) =>
      encodeVideo(7, seq, Date.now(), new Uint8Array([1]), probe, 2).buffer,
  };
}

test("hidden or navigating documents discard relay frames and probes before creating Blobs", async (t) => {
  const f = decodeFixture(t);
  f.video.setPageActive(false);
  f.video.pendingVideo = f.frame(1);
  await f.video.decodeVideo();
  await f.video.probe(f.frame(2, true));
  assert.equal(f.video.pendingVideo, null);
  assert.equal(f.decoded.length, 0, "beforeunload precedes document.hidden");
  f.video.setPageActive(true);
  f.doc.hidden = true;
  f.video.pendingVideo = f.frame(3);
  await f.video.decodeVideo();
  await f.video.probe(f.frame(4, true));
  assert.equal(f.decoded.length, 0);
  assert.equal(f.counts().acknowledgements, 0);
});

test("page restoration accepts fresh video but never renders or acknowledges obsolete decodes", async (t) => {
  const f = decodeFixture(t);
  f.video.pendingVideo = f.frame(1);
  const receiving = f.video.decodeVideo();
  const probing = f.video.probe(f.frame(2, true));
  f.video.pendingVideo = f.frame(3);
  f.video.setPageActive(false);
  f.video.setPageActive(true);
  f.decoded.forEach((decode) => decode.finish());
  await Promise.all([receiving, probing]);
  assert.deepEqual(f.counts(), { closed: 2, drawn: 0, acknowledgements: 0 });
  assert.equal(f.video.pendingVideo, null);
  f.video.pendingVideo = f.frame(4);
  const fresh = f.video.decodeVideo();
  f.decoded[2].finish();
  await fresh;
  const freshProbe = f.video.probe(f.frame(5, true));
  f.decoded[3].finish();
  await freshProbe;
  assert.deepEqual(f.counts(), { closed: 4, drawn: 1, acknowledgements: 2 });
});
