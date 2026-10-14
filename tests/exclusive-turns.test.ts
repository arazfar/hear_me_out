import assert from "node:assert/strict";
import test from "node:test";
import { encodeMicrophone } from "../shared/media";
import { RoomController, type Seat } from "../server/rooms/room";
import { judgeIsListening, scoreShare, type Turn } from "../shared/domain";
import { Client } from "../src/game/client";
import { flush, fakeSpeech } from "./fixtures";
function setup() {
  const c = new RoomController("1234");
  const a = c.game.addPlayer("Sam"),
    b = c.game.addPlayer("Alex");
  c.game.state.phase = "ROUND";
  c.game.state.matchId = "match";
  c.game.state.roundId = "round";
  const turn: Turn = {
    id: "turn",
    playerId: a.id,
    kind: "case",
    durationMs: 30000,
    remainingMs: 30000,
    deadline: Date.now() + 30000,
    pausedReason: null,
    sealing: false,
    inputEpoch: 1,
    inputState: "open",
    targets: { reasoning: 0, rebuttal: 0, impact: 0, wit: 0, clarity: 0 },
  };
  c.game.state.turn = turn;
  return { c, a, b, turn };
}
test("conversation survives floor and judge transitions; privacy still detaches RTC", async () => {
  const { c, a, b, turn } = setup(),
    client = new Client();
  client.state = c.game.state;
  client.session = { playerId: a.id } as any;
  const track = { enabled: true };
  client.capture.stream = { getAudioTracks: () => [track] } as any;
  let transmitted: unknown;
  client.peer.audioSender = {
    replaceTrack: async (next: unknown) => {
      transmitted = next;
    },
  } as any;
  for (const floor of [a.id, b.id]) {
    turn.playerId = floor;
    for (const speaking of [false, true]) {
      c.game.state.judge = speaking ? ({ status: "speaking" } as any) : null;
      client.capture.syncMicrophone();
      await flush();
      assert.equal(transmitted, track);
      assert(client.capture.microphoneAllowed());
      assert.equal(
        judgeIsListening(c.game.state, a.id),
        floor === a.id && !speaking,
      );
    }
  }
  client.capture.micMuted = true;
  client.capture.syncMicrophone();
  await flush();
  assert.equal(transmitted, null);
  assert.equal(track.enabled, false);
  client.capture.micMuted = false;
  client.setup.busy = true;
  client.capture.syncMicrophone();
  await flush();
  assert.equal(transmitted, null);
  c.close();
});
test("floor assignment is held atomically; stale finish and cancellation cannot open input", () => {
  const { c, turn } = setup();
  let published: any;
  c.broadcast = (e) => (published = e);
  c.transcription.rotate = () => {};
  c.playback.say = async () => {};
  c.onEvent({ type: "floor_granted", snapshot: c.game.snapshot() } as any);
  assert.equal(published.snapshot.turn.deadline, null);
  assert.equal(turn.inputState, "preparing");
  const speech = fakeSpeech(c, { turnId: "old-turn", matchId: "match" });
  c.playback.speech = speech;
  c.playback.finishSpeech(speech);
  assert.equal(turn.pausedReason, "judge");
  c.game.state.players.forEach((p) => (p.mediaReady = true));
  c.playback.speech = fakeSpeech(c, { turnId: turn.id });
  c.playback.cancelSpeech();
  assert.equal(turn.pausedReason, "judge");
  assert(!judgeIsListening(c.game.state, turn.playerId));
  c.close();
});
test("relay decode retains delayed frames, coalesces pending work and rejects old epochs", async () => {
  const { c } = setup();
  const client = new Client();
  client.state = c.game.state;
  const drawn: number[] = [];
  let closed = 0;
  const savedBitmap = globalThis.createImageBitmap,
    savedDocument = globalThis.document;
  (globalThis as any).document = {
    createElement: () => ({
      width: 256,
      height: 144,
      getContext: () => ({
        drawImage: (b: any) => drawn.push(b.seq),
        clearRect: () => {},
      }),
    }),
  };
  const frame = (seq: number) => {
    const f = new ArrayBuffer(22),
      v = new DataView(f);
    v.setUint32(1, client.state!.mediaEpoch, true);
    v.setUint32(5, seq, true);
    v.setFloat64(9, Date.now() - 5000, true);
    v.setUint8(21, seq);
    return f;
  };
  let release!: () => void;
  (globalThis as any).createImageBitmap = async (blob: Blob) => {
    const seq = new Uint8Array(await blob.arrayBuffer())[0];
    if (seq === 1)
      await new Promise<void>((r) => {
        release = r;
      });
    return { seq, close: () => closed++ };
  };
  try {
    client.video.pendingVideo = frame(1);
    const decoding = client.video.decodeVideo();
    while (!release) await new Promise((r) => setImmediate(r));
    client.video.pendingVideo = frame(2);
    client.video.pendingVideo = frame(3);
    release();
    await decoding;
    assert.deepEqual(drawn, [1, 3]);
    assert.equal(client.video.remoteFrameSeq, 3);
    assert(client.video.remoteFrame);
    client.video.pendingVideo = frame(4);
    const old = client.video.decodeVideo();
    client.video.resetVideo();
    await old;
    assert.deepEqual(drawn, [1, 3]);
    assert.equal(client.video.remoteFrameSeq, 0);
    assert.equal(closed, 3);
  } finally {
    globalThis.createImageBitmap = savedBitmap;
    globalThis.document = savedDocument;
  }
});

test("score display remains safe when a player leaves an unfinished match", () => {
  assert.equal(scoreShare([]), 0.5);
  assert.equal(scoreShare([{ scoreUnits: 40 }]), 0.5);
  assert.equal(scoreShare([{ scoreUnits: 0 }, { scoreUnits: 0 }]), 0.5);
  assert.equal(scoreShare([{ scoreUnits: 30 }, { scoreUnits: 10 }]), 0.75);
});

test("automatic device restore and a simultaneous enable click share one capture request", async () => {
  const client = new Client();
  let calls = 0,
    resumed = 0,
    release!: () => void;
  (client.capture as any).acquire = () => {
    calls++;
    return new Promise<void>((r) => {
      release = r;
    });
  };
  client.sound.context = {
    resume: () => {
      resumed++;
      return Promise.resolve();
    },
  } as any;
  const automatic = client.capture.devices(),
    gesture = client.capture.devices();
  assert.equal(automatic, gesture);
  assert.equal(calls, 1);
  assert.equal(resumed, 1);
  release();
  await automatic;
  assert.equal(client.capture.deviceRequest, null);
});

test("private checks cancel any friend gain ramp before isolation and restore the latest mute choice", () => {
  const client = new Client(),
    calls: unknown[] = [];
  client.sound.context = { currentTime: 1 } as AudioContext;
  client.sound.peerGain = {
    gain: {
      cancelScheduledValues: (time: number) => calls.push(["cancel", time]),
      setValueAtTime: (value: number, time: number) =>
        calls.push(["set", value, time]),
      setTargetAtTime: (value: number) => calls.push(["target", value]),
    },
  } as any;
  client.sound.peerPlayback = {
    port: { postMessage: (value: unknown) => calls.push(value) },
  } as any;
  client.setup.inline = true;
  client.sound.syncPeerPrivacy();
  assert.deepEqual(calls, [["cancel", 1], ["set", 0, 1], { type: "flush" }]);
  client.sound.peerMuted = true;
  client.setup.inline = false;
  client.sound.syncPeerPrivacy();
  assert.deepEqual(calls.at(-1), ["target", 0]);
});

test("server activity cannot overwrite local/RTC meters or imply audible muted relay speech", () => {
  const { c, a, b } = setup(),
    client = new Client();
  client.state = c.game.state;
  client.session = { playerId: a.id } as any;
  client.sound.context = { state: "running" } as AudioContext;
  const levels: number[] = [];
  client.on((update) => {
    if (update.activity) levels.push(update.activity.level);
  });
  const activity = (playerId: string) =>
    client.message({ type: "activity", playerId, level: 0.8 });
  client.state.mediaMode = "rtc";
  activity(a.id);
  activity(b.id);
  assert.deepEqual(levels, []);
  client.state.mediaMode = "wss";
  activity(a.id);
  activity(b.id);
  client.sound.peerMuted = true;
  activity(b.id);
  client.sound.peerMuted = false;
  client.setup.inline = true;
  activity(b.id);
  assert.deepEqual(levels, [0.8, 0, 0]);
  c.close();
});
