import assert from "node:assert/strict";
import test from "node:test";
import type { AddressInfo } from "node:net";
import { WebSocket } from "ws";
import { createApp } from "../server/app";
import type { InkSession } from "../server/providers/ink";
import type { TranscriptionStream } from "../server/rooms/services";
import {
  PROTOCOL_VERSION,
  type Session,
  type ServerMessage,
} from "../shared/protocol";
import { encodeMicrophone } from "../shared/media";
import { evidence, services, startRound } from "./fixtures";
import { post, waitFor } from "./ws-peer";

test("authenticated audio reconnection preserves a private check and keeps its transcript off both clients", async (t) => {
  type Provider = {
    stream: TranscriptionStream;
    handlers: ConstructorParameters<typeof InkSession>[3];
    sent: number;
  };
  const providers = new Map<string, Provider>();
  let connected = true;
  const app = createApp({
    providersReady: () => true,
    services: services({
      transcriptionAvailable: () => true,
      createTranscription: (playerId, roundId, turnId, handlers) => {
        const provider: Provider = {
          handlers,
          sent: 0,
          stream: {
            turnId,
            roundId,
            connected,
            closing: false,
            failed: false,
            close: async () => true,
            send: (pcm) => {
              if (!pcm.some((byte) => byte !== 0)) return;
              provider.sent++;
              handlers.caption("Bonk, hear", false);
              handlers.caption("Bonk, hear me out.", true);
              handlers.segment({
                id: "private-phrase",
                playerId,
                roundId,
                turnId,
                sessionEpoch: "provider",
                text: "Bonk, hear me out.",
                stableAt: Date.now(),
                eligible: turnId !== null,
                source: "voice",
              });
            },
          },
        };
        providers.set(playerId, provider);
        return provider.stream;
      },
    }),
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
  const messages = new Map<string, ServerMessage[]>();
  async function connect(session: Session, channel: "control" | "audio") {
    const ws = new WebSocket(
      base.replace(/^http/, "ws") + "/socket/" + channel,
    );
    ws.on("message", (bytes, binary) => {
      if (binary) return;
      const list = messages.get(session.playerId) || [];
      list.push(JSON.parse(bytes.toString()));
      messages.set(session.playerId, list);
    });
    await new Promise<void>((resolve) => ws.on("open", resolve));
    ws.send(
      JSON.stringify({
        ...session,
        code: undefined,
        type: "auth",
        protocolVersion: PROTOCOL_VERSION,
      }),
    );
    await waitFor(() => room.seats.get(session.playerId)!.sockets.has(channel));
    return ws;
  }
  await connect(first.session, "control");
  await connect(second.session, "control");
  const turn = startRound(room.game);
  room.playback.cancelSpeech();
  const session =
    turn.playerId === first.session.playerId ? first.session : second.session;
  const id = session.playerId;
  let audio = await connect(session, "audio");
  const accepted = evidence(room.game, "accepted-before-repair");
  room.game.registerSegment(accepted);
  room.game.score({
    ...accepted,
    turnId: turn.id,
    segmentId: accepted.id,
    criterion: "wit",
    quality: 2,
    reason: "The waffle comparison fits.",
  });
  room.game.recover("Mic repair");
  const report = () =>
    room.readiness.observe(id, {
      type: "media_status",
      captureId: "replacement",
      cameraId: "camera",
      mic: true,
      micSource: true,
      camera: true,
      foreground: true,
      localFrames: 10,
      remoteFrames: 10,
      mediaEpoch: room.game.state.mediaEpoch,
      rtc: true,
    });
  report();
  room.readiness.start(id, "private-check", "replacement");
  const old = providers.get(id)!;
  const held = {
    remaining: room.game.remaining(),
    ledger: structuredClone(room.game.state.ledger),
    recovery: room.game.state.recoveryDeadline,
    deadline: room.readiness.get(id).checkDeadline,
  };
  audio.close();
  await waitFor(() => !room.seats.get(id)!.sockets.has("audio"));
  const resumed = await post(base, "/api/resume", {
    ...session,
    resumeId: crypto.randomUUID(),
  });
  // Old providers cannot pass the check between epoch advancement and socket auth.
  old.handlers.segment({
    ...accepted,
    id: "obsolete",
    text: "Old private result",
  });
  assert.equal(room.readiness.get(id).passed, false);
  connected = false;
  await connect(resumed.session, "control");
  audio = await connect(resumed.session, "audio");
  const current = providers.get(id)!;
  assert.notEqual(current, old);
  assert.equal(current.stream.turnId, null);
  assert.equal(room.readiness.get(id).listening, false);
  audio.send(
    encodeMicrophone(
      room.game.state.mediaEpoch,
      0,
      Date.now(),
      new Uint8Array(640).fill(1),
      { purpose: "private", inputEpoch: room.readiness.get(id).inputEpoch },
    ),
  );
  await waitFor(() => room.seats.get(id)!.audioSeq === 0);
  assert.equal(
    current.sent,
    0,
    "no private PCM before the matching provider connects",
  );
  current.stream.connected = true;
  room.readiness.tick();
  assert.equal(room.readiness.get(id).checkDeadline, held.deadline);
  audio.send(
    encodeMicrophone(
      room.game.state.mediaEpoch,
      1,
      Date.now(),
      new Uint8Array(640).fill(1),
      { purpose: "private", inputEpoch: room.readiness.get(id).inputEpoch },
    ),
  );
  await waitFor(() => room.readiness.get(id).passed);
  assert.equal(current.sent, 1);
  assert.deepEqual(room.game.state.captions, {});
  assert.equal(room.game.turns.get(turn.id)!.segments.size, 1);
  assert.equal(room.judging.queue.length, 0);
  assert.deepEqual(room.game.state.claims, []);
  assert.deepEqual(room.game.state.ledger, held.ledger);
  assert.equal(room.game.remaining(), held.remaining);
  assert.equal(room.game.state.turn!.id, turn.id);
  assert.equal(room.game.state.recoveryDeadline, held.recovery);
  await waitFor(() =>
    messages
      .get(id)!
      .some((m) => m.type === "setup_result" && m.status === "passed"),
  );
  for (const [playerId, received] of messages) {
    assert(!received.some((m) => m.type === "transcript"));
    if (playerId !== id)
      assert(!received.some((m) => m.type === "setup_result"));
  }
});
