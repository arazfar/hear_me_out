import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "../src/game/client";
import type { Snapshot } from "../shared/domain";

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
});
