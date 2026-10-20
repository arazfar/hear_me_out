import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import {
  decodeJudgeAudio,
  encodeJudgeAudio,
  encodeMicrophone,
} from "../shared/media";
import { streamVoice } from "../server/providers/fish";
import { RoomController } from "../server/rooms/room";
import {
  fakeTranscription,
  flush,
  roomFixture,
  seat,
  services,
} from "./fixtures";
import { iceConfiguration } from "../server/transport/ice";
import { Client } from "../src/game/client";

function worklet(file: string, rate: number) {
  let Processor: any;
  const messages: any[] = [];
  const scope = {
    AudioWorkletProcessor: class {
      port = { onmessage: null, postMessage: (m: any) => messages.push(m) };
    },
    Float32Array,
    Int16Array,
    sampleRate: rate,
    currentTime: 0,
    registerProcessor: (_: string, value: any) => (Processor = value),
  };
  runInNewContext(readFileSync(file, "utf8"), scope);
  const processor = new Processor();
  return {
    processor,
    messages,
    scope,
    send: (data: any) => processor.port.onmessage({ data }),
    render: (input?: Float32Array) => {
      const output = new Float32Array(128);
      processor.process(input ? [[input]] : [], [[output]]);
      scope.currentTime += 128 / rate;
      return output;
    },
  };
}
for (const rate of [44100, 48000])
  test(`lossless judge FIFO at ${rate} Hz retains a 9-second tail across late chunks and EOF`, () => {
    const f = worklet("public/judge-worklet.js", rate),
      pcm = new Int16Array(44100 * 9 + 13).fill(4000);
    pcm.fill(30000, pcm.length - 13);
    f.send({ type: "reset", epoch: 1 });
    f.send({
      type: "pcm",
      epoch: 1,
      offset: 0,
      pcm: pcm.slice(0, 8820).buffer,
    });
    f.send({ type: "start", epoch: 1, at: 0.15 });
    const output: number[] = [];
    for (let i = 0; i < Math.ceil((rate * 0.8) / 128); i++)
      output.push(...f.render());
    assert(f.messages.some((m) => m.type === "buffering"));
    assert(!f.messages.some((m) => m.type === "drained"));
    f.send({
      type: "pcm",
      epoch: 1,
      offset: 8820,
      pcm: pcm.slice(8820).buffer,
    });
    for (let i = 0; i < Math.ceil((rate * 10) / 128); i++)
      output.push(...f.render());
    assert(
      !f.messages.some((m) => m.type === "drained"),
      "provider EOF is required even if all samples have arrived",
    );
    f.send({ type: "end", epoch: 1, samples: pcm.length });
    for (let i = 0; i < 100; i++) output.push(...f.render());
    const drained = f.messages.filter((m) => m.type === "drained");
    assert.equal(drained.length, 1);
    assert.equal(drained[0].samples, pcm.length);
    assert(
      output.some((x) => x > 0.9),
      "the final partial frame reaches rendered output",
    );
    if (rate === 44100)
      assert.deepEqual(
        output.filter((x) => x !== 0),
        Array.from(pcm, (x) => x / 32768),
      );
  });

test("output timing becoming unavailable still requires the conservative drain guard", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const client = new Client(),
    commands: any[] = [];
  let time = 10.05,
    timing = true;
  client.state = {
    judge: { id: "line", epoch: 1, status: "speaking", startAt: Date.now() },
  } as any;
  client.sound.context = {
    get currentTime() {
      return time;
    },
    state: "running",
    outputLatency: 0.02,
    baseLatency: 0.01,
    getOutputTimestamp: () =>
      timing
        ? { contextTime: 9.95, performanceTime: 500 }
        : { contextTime: 0, performanceTime: 0 },
  } as any;
  client.command = (command) => {
    commands.push(command);
    return crypto.randomUUID();
  };
  const node = { port: { postMessage() {}, onmessage: null } } as any;
  client.sound.judgePlayback = node;
  client.playback.activeEpoch = 1;
  client.playback.bind(node);
  node.port.onmessage({
    data: { type: "drained", epoch: 1, samples: 44100, contextTime: 10 },
  });
  timing = false;
  t.mock.timers.tick(20);
  assert(!commands.some((c) => c.status === "complete"));
  time = 10.3;
  t.mock.timers.tick(20);
  assert.equal(commands.filter((c) => c.status === "complete").length, 1);
  client.playback.resetJudgePlayback();
});

test("capture flushes partial frames before a same-channel end marker and never retags old samples", () => {
  const f = worklet("public/pcm-worklet.js", 48000);
  f.send({
    type: "gate",
    purpose: "social",
    inputEpoch: 0,
    mediaEpoch: 1,
    serverAt: 100000,
    contextAt: 0,
  });
  f.render(new Float32Array(128).fill(0.1));
  f.send({
    type: "gate",
    purpose: "gameplay",
    inputEpoch: 7,
    mediaEpoch: 1,
    serverAt: 100003,
    contextAt: f.scope.currentTime,
    endsAt: 101000,
  });
  f.render(new Float32Array(128).fill(0.5));
  f.render(new Float32Array(128).fill(0.5));
  f.send({ type: "done", inputEpoch: 7, nextPurpose: "social" });
  f.render(new Float32Array(128).fill(0.9));
  f.send({
    type: "gate",
    purpose: "private",
    inputEpoch: 8,
    mediaEpoch: 1,
    serverAt: 100010,
    contextAt: f.scope.currentTime,
    requestId: "isolate",
  });
  const frames = f.messages.filter((m) => m.type === "pcm");
  assert.deepEqual(
    frames.map((m) => m.purpose),
    ["social", "gameplay", "social"],
  );
  assert.equal(new Int16Array(frames[1].pcm).length, 86);
  assert(new Int16Array(frames[1].pcm).every((x) => x === 16384));
  assert.equal(f.messages[2].type, "end");
  assert.equal(f.messages[2].inputEpoch, 7);
  assert.equal(f.messages.at(-1).type, "isolated");
});

test("capture clock refresh preserves queued timestamps and ownership without ending a grant", () => {
  const f = worklet("public/pcm-worklet.js", 48000);
  f.send({
    type: "gate",
    purpose: "gameplay",
    inputEpoch: 7,
    mediaEpoch: 1,
    serverAt: 100000,
    contextAt: 0,
    endsAt: 100500,
  });
  f.render(new Float32Array(128).fill(0.5));
  f.send({ type: "clock", serverAt: 100400, contextAt: f.scope.currentTime });
  assert.equal(f.messages.length, 1);
  assert.equal(f.messages[0].type, "pcm");
  assert(
    f.messages[0].capturedAt < 100003,
    "the buffered frame keeps its old timestamp",
  );
  assert.equal(new Int16Array(f.messages[0].pcm).length, 43);
  for (let i = 0; i < 50; i++) f.render(new Float32Array(128).fill(0.5));
  const frames = f.messages.filter(
    (m) => m.type === "pcm" && m.purpose === "gameplay",
  );
  assert(
    frames
      .slice(1)
      .every((m) => m.capturedAt >= 100400 && m.capturedAt < 100500),
  );
  assert(frames.every((m) => m.inputEpoch === 7));
  const ends = f.messages.filter((m) => m.type === "end");
  assert.equal(ends.length, 1);
  assert(
    Math.abs(ends[0].capturedAt - 100500) < 0.1,
    "deadline uses the refreshed mapping",
  );
});

test("Fish retains all native int16 samples beyond old limits and frames oversized provider chunks safely", async (t) => {
  const before = process.env.FISH_AUDIO_API_KEY;
  process.env.FISH_AUDIO_API_KEY = "fixture";
  t.after(() => {
    if (before === undefined) delete process.env.FISH_AUDIO_API_KEY;
    else process.env.FISH_AUDIO_API_KEY = before;
  });
  const pcm = new Int16Array(44100 * 9 + 13).fill(4000);
  pcm[pcm.length - 1] = 30000;
  t.mock.method(
    globalThis,
    "fetch",
    async () => new Response(new Uint8Array(pcm.buffer)),
  );
  const chunks: Uint8Array[] = [];
  await streamVoice(
    "A complete sentence.",
    (chunk) => chunks.push(chunk),
    () => false,
  );
  assert.equal(Buffer.concat(chunks).length, pcm.length * 2);
  assert.equal(Buffer.concat(chunks).readInt16LE(pcm.byteLength - 2), 30000);
  assert.throws(
    () => encodeJudgeAudio(1, 0, 0, new Uint8Array(131072)),
    /Invalid/,
  );
  for (let offset = 0, seq = 0; offset < pcm.length; offset += 882, seq++) {
    const packet = encodeJudgeAudio(
      1,
      seq,
      offset,
      new Uint8Array(pcm.slice(offset, offset + 882).buffer),
    );
    assert(decodeJudgeAudio(packet));
    assert(packet.length <= 1781);
  }
});

test("both authenticated rendered completions, not generation or one client's clock, release Bonk", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let now = 100000;
  const room = new RoomController(
    "1234",
    services({
      now: () => now,
      setTimeout,
      clearTimeout,
      streamVoice: async (_text, receive) => {
        receive(
          new Uint8Array(new Int16Array(44100 * 9 + 13).fill(1000).buffer),
        );
        return 9;
      },
    }),
  );
  const packets = new Map<string, Uint8Array[]>();
  for (const name of ["Alex", "Sam"]) {
    const id = room.game.addPlayer(name).id,
      s = seat();
    packets.set(id, []);
    s.sockets.set("judge", {
      readyState: 1,
      bufferedAmount: 0,
      send: (p: Uint8Array) => packets.get(id)!.push(p),
      close() {},
    } as any);
    room.seats.set(id, s);
  }
  await room.playback.say(
    "Those final syllables deserve their day in court.",
    null,
    false,
  );
  const speech = room.playback.speech!,
    ids = [...room.seats.keys()];
  assert(speech.done);
  assert.equal(speech.samples, 44100 * 9 + 13);
  for (const id of ids) room.playback.audioReady(id, speech.id, speech.epoch);
  room.playback.audioPlayback(
    ids[0],
    speech.id,
    speech.epoch,
    "complete",
    speech.samples,
  );
  assert(
    room.playback.speech,
    "an implausibly early completion does not count",
  );
  for (let i = 0; i < 40; i++) {
    now += 250;
    for (const id of ids)
      room.playback.audioPlayback(
        id,
        speech.id,
        speech.epoch,
        "progress",
        Math.min(
          speech.samples,
          Math.max(0, Math.floor((now - speech.startedAt!) * 44.1)),
        ),
      );
    t.mock.timers.tick(250);
  }
  assert(
    room.playback.speech,
    "generation and scheduled duration never finish speech",
  );
  for (const stream of packets.values()) {
    const decoded = stream.map(decodeJudgeAudio);
    assert(decoded.every(Boolean));
    assert.equal(
      decoded.at(-1)!.end,
      true,
      JSON.stringify({
        sent: speech.sent,
        frames: speech.frames.length,
        started: speech.startedAt,
        fallback: speech.fallback,
        repair: speech.repairAt,
        now,
        last: decoded.at(-1)?.offset,
      }),
    );
    assert.equal(decoded.at(-1)!.offset, speech.samples);
    assert.equal(
      decoded.slice(0, -1).reduce((n, f) => n + f!.pcm.length, 0),
      speech.samples,
    );
  }
  room.playback.audioPlayback(
    ids[0],
    speech.id,
    speech.epoch,
    "complete",
    speech.samples,
  );
  assert(room.playback.speech);
  room.playback.audioPlayback(
    ids[1],
    "old",
    speech.epoch,
    "complete",
    speech.samples,
  );
  assert(room.playback.speech);
  room.playback.audioPlayback(
    ids[1],
    speech.id,
    speech.epoch,
    "complete",
    speech.samples,
  );
  assert.equal(room.playback.speech, null);
  assert.equal(room.game.state.judge?.status, "silent");
  assert.equal(room.timers.size, 0, "completed speech retires its watchdog");
  room.close();
});

test("capture grants hold the clock; ordered Done drains immediately while late epochs cannot enter the successor", async () => {
  let now = 100000;
  const { room, turn } = roomFixture({ now: () => now });
  room.playback.say = async () => {};
  const audio: Buffer[] = [];
  room.transcription.ink.set(
    turn.playerId,
    fakeTranscription(turn.id, room.game.state.roundId!, (pcm) =>
      audio.push(pcm),
    ),
  );
  room.turnCoordinator.assigned();
  room.turnCoordinator.advance();
  assert.equal(turn.inputState, "granted");
  assert.equal(turn.deadline, null);
  now += 150;
  const send = (seq: number, end = false) =>
    room.media.audio(
      turn.playerId,
      Buffer.from(
        encodeMicrophone(
          room.game.state.mediaEpoch,
          seq,
          now,
          new Uint8Array(end ? 0 : 18).fill(1),
          { purpose: "gameplay", inputEpoch: turn.inputEpoch!, end },
        ),
      ),
    );
  send(1);
  assert.equal(turn.inputState, "open");
  assert.equal(room.game.remaining(), 30000);
  send(2, true);
  room.game.endTurn(turn.playerId, turn.id, 2);
  await flush();
  assert.notEqual(room.game.state.turn?.id, turn.id, "no fixed 500 ms wait");
  assert.equal(audio.filter((p) => p.some((x) => x)).length, 1);
  send(3);
  assert.equal(audio.filter((p) => p.some((x) => x)).length, 1);
  room.close();
});

test("TURN credentials expire and are scoped without returning the shared secret", (t) => {
  const oldUrls = process.env.TURN_URLS,
    oldSecret = process.env.TURN_SECRET;
  process.env.TURN_URLS = "turn:turn.example:3478,turns:turn.example:5349";
  process.env.TURN_SECRET = "fixture-secret";
  t.after(() => {
    if (oldUrls === undefined) delete process.env.TURN_URLS;
    else process.env.TURN_URLS = oldUrls;
    if (oldSecret === undefined) delete process.env.TURN_SECRET;
    else process.env.TURN_SECRET = oldSecret;
  });
  const config = iceConfiguration("room:seat:1", 100000);
  assert.equal(config.expiresAt, 700000);
  assert.equal(config.iceServers[1].username, "700:room:seat:1");
  assert(config.iceServers[1].credential);
  assert(!JSON.stringify(config).includes("fixture-secret"));
});

test("a complete cached utterance retries once, rejects an obsolete connection, then falls back with its full caption", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let now = 100000;
  const room = new RoomController(
    "1234",
    services({ now: () => now, setTimeout, clearTimeout }),
  );
  for (const name of ["Alex", "Sam"]) {
    const player = room.game.addPlayer(name),
      connection = seat();
    connection.sockets.set("judge", {
      readyState: 1,
      bufferedAmount: 0,
      send: () => {},
      close: () => {},
    } as any);
    room.seats.set(player.id, connection);
  }
  t.after(() => room.close());
  const text = "These syrup pockets deserve to finish their sentence.";
  await room.playback.say(text, null, false);
  const old = room.playback.speech!,
    ids = [...room.seats.keys()];
  room.seats.get(ids[0])!.epoch++;
  room.playback.audioReady(ids[0], old.id, old.epoch);
  assert.equal(
    old.ready.size,
    0,
    "an obsolete playback cannot adopt a replacement connection",
  );
  room.playback.voiceFailure(true);
  now += 20;
  t.mock.timers.tick(20);
  await flush();
  const replay = room.playback.speech!;
  assert.equal(replay.attempt, 1);
  assert.notEqual(replay.epoch, old.epoch);
  assert.equal(replay.samples, old.samples);
  room.playback.audioPlayback(
    ids[1],
    old.id,
    old.epoch,
    "complete",
    old.samples,
  );
  assert.equal(room.playback.speech, replay);
  room.playback.voiceFailure(true);
  assert.equal(room.game.state.judge?.status, "captions");
  assert.equal(room.game.state.judge?.text, text);
  now += 6000;
  t.mock.timers.tick(6000);
  assert.equal(room.playback.speech, null);
  room.close();
});

test("backpressure stays bounded and stalled generation ends in shared captions without estimated completion", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let now = 100000,
    sends = 0;
  const room = new RoomController(
    "1234",
    services({ now: () => now, setTimeout, clearTimeout }),
  );
  for (const name of ["Alex", "Sam"]) {
    const player = room.game.addPlayer(name),
      connection = seat();
    connection.sockets.set("judge", {
      readyState: 1,
      bufferedAmount: 70000,
      send: () => sends++,
      close: () => {},
    } as any);
    room.seats.set(player.id, connection);
  }
  t.after(() => room.close());
  await room.playback.say(
    "The whole line stays in the bounded queue.",
    null,
    false,
  );
  assert.equal(sends, 0);
  for (let i = 0; i < 32; i++) {
    now += 250;
    t.mock.timers.tick(250);
    await flush();
  }
  assert.equal(sends, 0);
  assert.equal(room.game.state.judge?.status, "captions");
  room.playback.cancelSpeech();
  room.services.streamVoice = async () => new Promise(() => {});
  void room.playback.say(
    "This complete caption survives a failed provider.",
    null,
    false,
  );
  for (let i = 0; i < 21; i++) {
    now += 250;
    t.mock.timers.tick(250);
  }
  assert.equal(room.game.state.judge?.status, "captions");
  assert.equal(
    room.game.state.judge?.text,
    "This complete caption survives a failed provider.",
  );
  room.close();
});

test("buffering closes the capture window, preserves its in-flight tail and accepts a racing Done", async () => {
  let now = 100000;
  const { room, turn } = roomFixture({
    now: () => now,
    streamVoice: async () => new Promise(() => {}),
  });
  const audio: Buffer[] = [];
  let closed = 0;
  const stream = fakeTranscription(turn.id, room.game.state.roundId!, (pcm) =>
    audio.push(pcm),
  );
  stream.close = async () => {
    closed++;
    return true;
  };
  room.transcription.ink.set(turn.playerId, stream);
  const epoch = turn.inputEpoch!;
  now += 1000;
  const cutoff = now;
  void room.playback.say("A complete sentence needs a moment.", null, false);
  assert.equal(turn.inputState, "preparing");
  assert.equal(
    turn.inputEpoch,
    epoch,
    "the closing epoch still owns its in-flight tail",
  );
  assert.equal(turn.deadline, null);
  now += 100;
  const send = (seq: number, at: number, end = false) =>
    room.media.audio(
      turn.playerId,
      Buffer.from(
        encodeMicrophone(
          room.game.state.mediaEpoch,
          seq,
          at,
          new Uint8Array(end ? 0 : 640).fill(1),
          { purpose: "gameplay", inputEpoch: epoch, end },
        ),
      ),
    );
  send(1, cutoff - 10);
  send(2, cutoff + 10);
  assert.deepEqual(
    audio.filter((pcm) => pcm.some((x) => x)).map((pcm) => pcm.length),
    [322],
    "retain only samples captured before Bonk took the floor",
  );
  assert.equal(room.game.remaining(), 29000);
  send(3, now, true);
  room.game.endTurn(turn.playerId, turn.id, 3);
  await flush();
  assert.equal(closed, 1, "Done drains through the already-arrived end marker");
  room.close();
});

test("ICE and metadata exports require the current authenticated seat and never expose speech or secrets", async (t) => {
  const { createApp } = await import("../server/app");
  const app = createApp({ services: services() });
  await new Promise<void>((resolve) =>
    app.server.listen(0, "127.0.0.1", resolve),
  );
  t.after(() => app.close());
  const address = app.server.address() as import("node:net").AddressInfo;
  const base = `http://127.0.0.1:${address.port}`;
  const post = (path: string, data: unknown) =>
    fetch(base + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  const { session } = await (await post("/api/rooms", { name: "Alex" })).json();
  for (const path of ["/api/ice", "/api/diagnostics"]) {
    assert.equal((await post(path, {})).status, 401);
    assert.equal(
      (await post(path, { ...session, connectionEpoch: 2 })).status,
      401,
    );
    const response = await post(path, session);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    const data = await response.json();
    assert(!JSON.stringify(data).includes(session.token));
    if (path.endsWith("diagnostics"))
      assert.deepEqual(Object.keys(data).sort(), [
        "failures",
        "metrics",
        "protocolVersion",
        "sttConnections",
        "timeline",
      ]);
  }
});

test("deadline settlement keeps only the eligible tail and a racing Done is harmless", async () => {
  const { command } = await import("../server/rooms/commands");
  let now = 100000;
  const { room, turn } = roomFixture({ now: () => now });
  room.playback.say = async () => {};
  const audio: Buffer[] = [];
  room.transcription.ink.set(
    turn.playerId,
    fakeTranscription(turn.id, room.game.state.roundId!, (pcm) =>
      audio.push(pcm),
    ),
  );
  const deadline = turn.deadline!;
  now = deadline + 100;
  room.game.tick();
  room.media.audio(
    turn.playerId,
    Buffer.from(
      encodeMicrophone(
        room.game.state.mediaEpoch,
        1,
        deadline - 10,
        new Uint8Array(640).fill(1),
        { purpose: "gameplay", inputEpoch: turn.inputEpoch! },
      ),
    ),
  );
  assert.equal(
    audio[0].length,
    161 * 2,
    "late delivery cannot extend the capture window",
  );
  await command({} as any, room, turn.playerId, {
    commandId: "racing-done",
    connectionEpoch: 1,
    matchId: room.game.state.matchId,
    expectedPhaseVersion: room.game.state.phaseVersion,
    command: { type: "done", turnId: turn.id, lastAudioSeq: 2 },
  });
  assert.equal(room.game.state.turn?.id, turn.id);
  room.media.audio(
    turn.playerId,
    Buffer.from(
      encodeMicrophone(
        room.game.state.mediaEpoch,
        2,
        deadline,
        new Uint8Array(),
        { purpose: "gameplay", inputEpoch: turn.inputEpoch!, end: true },
      ),
    ),
  );
  await flush();
  assert.notEqual(room.game.state.turn?.id, turn.id);
  room.close();
});
