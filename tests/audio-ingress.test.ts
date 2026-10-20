import assert from "node:assert/strict";
import test from "node:test";
import type { AddressInfo } from "node:net";
import { WebSocket } from "ws";
import { createApp } from "../server/app";
import { AudioBudget } from "../server/transport/audio-budget";
import { encodeMicrophone } from "../shared/media";
import { PROTOCOL_VERSION } from "../shared/protocol";
import {
  fakeTranscription,
  flush,
  roomFixture,
  services,
  startRound,
} from "./fixtures";
import { post, waitFor } from "./ws-peer";

for (const frames of [120, 160]) {
  test(`authenticated catch-up admits ${frames} frames, a partial frame, and the ordered end exactly once`, async (t) => {
    const now = 100000;
    const app = createApp({
      providersReady: () => true,
      services: services({ now: () => now }),
    });
    await new Promise<void>((resolve) =>
      app.server.listen(0, "127.0.0.1", resolve),
    );
    t.after(() => app.close());
    const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
    const first = await post(base, "/api/rooms", { name: "Alex" });
    const second = await post(base, "/api/join", {
      name: "Sam",
      code: first.session.code,
    });
    const room = app.registry.rooms.get(first.session.code)!;
    room.tick = () => {};
    const turn = startRound(room.game);
    room.playback.cancelSpeech();
    room.playback.pendingHandoff = null;
    room.playback.hostCues = [];
    room.playback.say = async () => {};
    const session =
      turn.playerId === first.session.playerId ? first.session : second.session;
    const ws = new WebSocket(base.replace(/^http/, "ws") + "/socket/audio");
    await new Promise<void>((resolve) => ws.on("open", resolve));
    ws.send(
      JSON.stringify({
        ...session,
        code: undefined,
        type: "auth",
        protocolVersion: PROTOCOL_VERSION,
      }),
    );
    await waitFor(() => room.seats.get(turn.playerId)!.sockets.has("audio"));
    const admitted: Buffer[] = [];
    let closed = 0;
    const stream = fakeTranscription(turn.id, room.game.state.roundId!, (pcm) =>
      admitted.push(pcm),
    );
    stream.close = async () => {
      closed++;
      return true;
    };
    room.transcription.ink.set(turn.playerId, stream);
    room.game.grantInput(1);
    turn.inputGrantedAt = now - 3000;
    const expected: Buffer[] = [];
    for (let seq = 1; seq <= frames + 1; seq++) {
      const pcm = Buffer.alloc(seq > frames ? 18 : 640, seq);
      expected.push(pcm);
      ws.send(
        encodeMicrophone(
          room.game.state.mediaEpoch,
          seq,
          now - 2900 + seq * 18,
          pcm,
          {
            purpose: "gameplay",
            inputEpoch: 1,
          },
        ),
      );
    }
    const end = frames + 2;
    const marker = encodeMicrophone(
      room.game.state.mediaEpoch,
      end,
      now,
      new Uint8Array(),
      {
        purpose: "gameplay",
        inputEpoch: 1,
        end: true,
      },
    );
    ws.send(marker);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(room.seats.get(turn.playerId)!.audioSeq, end);
    assert.deepEqual(admitted, expected);
    room.game.endTurn(turn.playerId, turn.id, end);
    await flush();
    assert.equal(closed, 1);
    assert.notEqual(room.game.state.turn?.id, turn.id);
    ws.send(marker);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(closed, 1);
    assert.deepEqual(admitted, expected);
  });
}

test("message exhaustion explicitly aborts eligible gameplay instead of silently losing evidence", (t) => {
  const { room, turn } = roomFixture({ now: () => 100000 });
  t.after(() => room.close());
  let sent = 0;
  room.transcription.ink.set(
    turn.playerId,
    fakeTranscription(turn.id, room.game.state.roundId!, () => sent++),
  );
  for (let seq = 1; seq <= 201; seq++)
    room.media.audio(
      turn.playerId,
      Buffer.from(
        encodeMicrophone(
          room.game.state.mediaEpoch,
          seq,
          100000,
          new Uint8Array(2).fill(1),
          { purpose: "gameplay", inputEpoch: 1 },
        ),
      ),
    );
  assert.equal(sent, 200);
  assert.equal(room.game.state.phase, "ABORTED");
  assert.equal(room.game.state.winnerId, null);
});

test("byte budget, sustained traffic, refill and backwards clocks stay bounded", () => {
  const bytes = new AudioBudget();
  assert.equal(bytes.admit(128 * 1024, 0), null);
  assert.equal(bytes.admit(1, 0), "bytes");
  assert.equal(bytes.admit(40 * 1024, 1000), null);
  assert.equal(bytes.admit(1, 1000), "bytes");
  assert.equal(bytes.admit(1, 0), "bytes");
  const messages = new AudioBudget();
  for (let i = 0; i < 200; i++) assert.equal(messages.admit(1, 0), null);
  assert.equal(messages.admit(1, 0), "messages");
  for (let second = 1; second <= 10; second++) {
    for (let i = 0; i < 100; i++)
      assert.equal(messages.admit(1, second * 1000), null);
    assert.equal(messages.admit(1, second * 1000), "messages");
  }
  const normal = new AudioBudget();
  for (let frame = 0; frame < 3000; frame++) {
    assert.equal(normal.admit(671, frame * 20), null);
    if (frame % 50 === 0)
      assert.equal(
        normal.admit(49, frame * 20),
        null,
        "clock refresh partial frame",
      );
  }
});

for (const sealing of [false, true]) {
  test(`exhausting the ordered end marker aborts with sealing=${sealing}`, (t) => {
    const { room, turn } = roomFixture({ now: () => 100000 });
    t.after(() => room.close());
    room.transcription.ink.set(
      turn.playerId,
      fakeTranscription(turn.id, room.game.state.roundId!),
    );
    for (let seq = 1; seq <= 200; seq++)
      room.media.audio(
        turn.playerId,
        Buffer.from(
          encodeMicrophone(
            room.game.state.mediaEpoch,
            seq,
            100000,
            new Uint8Array(2),
          ),
        ),
      );
    if (sealing) room.game.endTurn(turn.playerId, turn.id, 201);
    room.media.audio(
      turn.playerId,
      Buffer.from(
        encodeMicrophone(
          room.game.state.mediaEpoch,
          201,
          100000,
          new Uint8Array(),
          { purpose: "gameplay", inputEpoch: 1, end: true },
        ),
      ),
    );
    assert.equal(room.game.state.phase, "ABORTED");
    assert.equal(room.media.audioRejections.messages, 1);
  });
}

test("byte exhaustion aborts current evidence but obsolete epochs and social floods cannot abort a turn", (t) => {
  const { room, turn } = roomFixture({ now: () => 100000 });
  t.after(() => room.close());
  let sent = 0;
  room.transcription.ink.set(
    turn.playerId,
    fakeTranscription(turn.id, room.game.state.roundId!, () => sent++),
  );
  for (let seq = 1; seq <= 40; seq++)
    room.media.audio(
      turn.playerId,
      Buffer.from(
        encodeMicrophone(
          room.game.state.mediaEpoch,
          seq,
          100000,
          new Uint8Array(3200).fill(1),
          { purpose: "gameplay", inputEpoch: 1 },
        ),
      ),
    );
  assert.equal(sent, 40);
  for (let i = 0; i < 500; i++)
    room.media.audio(
      turn.playerId,
      Buffer.from(
        encodeMicrophone(
          room.game.state.mediaEpoch,
          41,
          100000,
          new Uint8Array(3200),
          { purpose: "gameplay", inputEpoch: 99 },
        ),
      ),
    );
  assert.equal(room.game.state.phase, "ROUND");
  room.media.audio(
    turn.playerId,
    Buffer.from(
      encodeMicrophone(
        room.game.state.mediaEpoch,
        41,
        100000,
        new Uint8Array(3200),
        { purpose: "gameplay", inputEpoch: 1 },
      ),
    ),
  );
  assert.equal(room.game.state.phase, "ABORTED");
  assert.equal(sent, 40);
  assert.equal(room.media.audioRejections.bytes, 501);
});

test("private check exhaustion fails only that check and retires its provider", (t) => {
  const { room, turn } = roomFixture({ now: () => 100000 });
  t.after(() => room.close());
  room.game.recover("Private mic repair");
  const check = room.readiness.get(turn.playerId);
  check.setup = "checking";
  check.inputEpoch = 9;
  check.checkId = "private";
  let closed = 0;
  const stream = fakeTranscription(null, room.game.state.roundId!);
  stream.close = async () => {
    closed++;
    return true;
  };
  room.transcription.ink.set(turn.playerId, stream);
  room.readiness.tick = () => {};
  for (let seq = 1; seq <= 201; seq++)
    room.media.audio(
      turn.playerId,
      Buffer.from(
        encodeMicrophone(
          room.game.state.mediaEpoch,
          seq,
          100000,
          new Uint8Array(2),
          { purpose: "private", inputEpoch: 9 },
        ),
      ),
    );
  assert.equal(check.setup, "failed");
  assert.equal(closed, 1);
  assert.equal(room.transcription.ink.size, 0);
  assert.equal(room.game.state.phase, "RECOVERING");
});

test("resuming a seat resets sequence ownership without granting a fresh audio burst", async (t) => {
  const app = createApp({ services: services({ now: () => 100000 }) });
  await new Promise<void>((resolve) =>
    app.server.listen(0, "127.0.0.1", resolve),
  );
  t.after(() => app.close());
  const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  const { session } = await post(base, "/api/rooms", { name: "Alex" });
  const room = app.registry.rooms.get(session.code)!;
  const seat = room.seats.get(session.playerId)!;
  for (let seq = 0; seq < 200; seq++)
    room.media.audio(
      session.playerId,
      Buffer.from(
        encodeMicrophone(
          room.game.state.mediaEpoch,
          seq,
          100000,
          new Uint8Array(2),
        ),
      ),
    );
  await post(base, "/api/resume", {
    ...session,
    resumeId: crypto.randomUUID(),
  });
  room.media.audio(
    session.playerId,
    Buffer.from(
      encodeMicrophone(
        room.game.state.mediaEpoch,
        0,
        100000,
        new Uint8Array(2),
      ),
    ),
  );
  assert.equal(seat.epoch, 2);
  assert.equal(seat.audioSeq, -1);
  assert.equal(room.media.audioRejections.messages, 1);
});
