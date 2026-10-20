import assert from "node:assert/strict";
import test from "node:test";
import type { AddressInfo } from "node:net";
import Cartesia from "@cartesia/cartesia-js/index.js";
import { WebSocket, WebSocketServer } from "ws";
import { InkSession, inkTransport } from "../server/providers/ink";
import { encodeMicrophone } from "../shared/media";
import { deferred, fakeTranscription, flush, roomFixture } from "./fixtures";
import { waitFor } from "./ws-peer";
import { inkFixture } from "./ink-fixture";

for (const fault of ["clean", "abnormal", "error", "silent"] as const) {
  test(`SDK transcription drainage: ${fault}`, async (t) => {
    const server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    await new Promise<void>((resolve) => server.on("listening", resolve));
    t.after(async () => {
      for (const socket of server.clients) socket.terminate();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });
    server.on("connection", (socket) => {
      socket.send(JSON.stringify({ type: "connected" }));
      socket.on("message", (data, binary) => {
        if (binary || JSON.parse(data.toString()).type !== "close") return;
        if (fault === "abnormal") socket.terminate();
        else if (fault === "error")
          socket.send(JSON.stringify({ type: "error", error: "fixture" }));
        else {
          if (fault === "clean")
            socket.send(
              JSON.stringify({
                type: "turn.end",
                transcript: "Waffles distribute syrup evenly.",
              }),
            );
          socket.close(1000);
        }
      });
    });
    const sdk = new Cartesia({
      apiKey: "local-fixture",
      baseURL: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    });
    const transport = sdk.stt.autoFinalize.websocket({
      model: "ink-2",
      encoding: "pcm_s16le",
      sample_rate: 16000,
    });
    const finals: string[] = [];
    const stream = new InkSession(
      "a",
      "round",
      "turn",
      {
        segment: (s) => finals.push(s.text),
        caption: () => {},
        start: () => {},
        end: () => {},
        error: () => {},
      },
      inkTransport(transport),
    );
    await waitFor(() => stream.connected);
    stream.send(Buffer.alloc(640, fault === "silent" ? 0 : 17));
    const before = Date.now();
    assert.equal(await stream.close(), fault === "clean" || fault === "silent");
    assert.deepEqual(
      finals,
      fault === "clean" ? ["Waffles distribute syrup evenly."] : [],
    );
    await waitFor(() => server.clients.size === 0, 1000);
    assert(
      Date.now() - before < 1000,
      "terminal failure must dispose promptly",
    );
  });
}

test("aborting retires gameplay streams and pending preparation, but permits private checks", async (t) => {
  let closed = 0,
    sent = 0;
  const finishes = Array.from({ length: 4 }, () => deferred<boolean>());
  const { room, turn } = roomFixture({
    transcriptionAvailable: () => true,
    createTranscription: (_id, roundId, turnId) => {
      const stream = fakeTranscription(turnId, roundId, () => sent++);
      stream.close = () => {
        stream.closing = true;
        return finishes[closed++].promise;
      };
      return stream;
    },
  });
  t.after(() => room.close());
  const id = turn.playerId;
  room.seats.get(id)!.sockets.set("audio", { close() {} } as WebSocket);
  room.readiness.get(id).passed = true;
  for (let i = 0; i < 4; i++) room.transcription.rotate(id, turn.id, true);
  room.transcription.rotate(id, "pending-turn", true);
  room.game.abort("Fixture abort");
  room.media.audio(
    id,
    Buffer.from(
      encodeMicrophone(
        room.game.state.mediaEpoch,
        1,
        room.services.now(),
        new Uint8Array(640),
        { purpose: "health", inputEpoch: 0 },
      ),
    ),
  );
  assert.equal(sent, 0);
  assert.equal(closed, 4);
  assert.equal(room.transcription.ink.size, 0);
  finishes.forEach((finish) => finish.resolve(true));
  await flush();
  assert.equal(room.transcription.active.size, 0);
  room.transcription.rotate(id, "obsolete-turn", true);
  assert.equal(room.transcription.ink.size, 0);
  const check = room.readiness.get(id);
  check.setup = "checking";
  check.checkId = "private";
  check.captureId = "new-capture";
  room.transcription.rotate(id);
  assert.equal(room.transcription.ink.get(id)?.turnId, null);
  // This fifth stream is a permitted private check, not abandoned gameplay.
  finishes.push(deferred<boolean>());
  finishes[4].resolve(true);
});

test("unresponsive drainage keeps the five-second deadline and rejects late evidence", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const finals: string[] = [];
  const { stream, socket } = inkFixture({
    segment: (s) => finals.push(s.text),
  });
  socket.send = () => {};
  const drained = stream.close();
  t.mock.timers.tick(4999);
  assert.equal(stream.failed, false);
  assert.equal(socket.ended, false);
  t.mock.timers.tick(1);
  assert.equal(await drained, false);
  assert.equal(socket.ended, true);
  stream.update("This arrived after failure.", true);
  assert.deepEqual(finals, []);
});

test("five failed SDK drains release physical sockets before leaving room accounting", async (t) => {
  const server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise<void>((resolve) => server.on("listening", resolve));
  t.after(async () => {
    for (const socket of server.clients) socket.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  server.on("connection", (socket) => {
    // Keep reading TCP EOF, but never cooperate with the close handshake.
    socket.close = () => {};
    socket.send(JSON.stringify({ type: "connected" }));
    socket.on("message", (data, binary) => {
      if (!binary && JSON.parse(data.toString()).type === "close")
        socket.send(JSON.stringify({ type: "error", error: "drain failure" }));
    });
  });
  const sdk = new Cartesia({
    apiKey: "local-fixture",
    baseURL: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
  });
  const { room, turn } = roomFixture({
    transcriptionAvailable: () => true,
    createTranscription: (id, roundId, turnId, handlers) =>
      new InkSession(
        id,
        roundId,
        turnId,
        handlers,
        inkTransport(
          sdk.stt.autoFinalize.websocket({
            model: "ink-2",
            encoding: "pcm_s16le",
            sample_rate: 16000,
          }),
        ),
      ),
  });
  t.after(() => room.close());
  room.seats
    .get(turn.playerId)!
    .sockets.set("audio", { close() {} } as WebSocket);
  for (let i = 0; i < 5; i++) {
    room.transcription.rotate(turn.playerId, turn.id, true);
    const stream = room.transcription.ink.get(turn.playerId)!;
    await waitFor(() => stream.connected);
    const draining = stream.close();
    assert.equal(room.transcription.active.size, 1);
    assert.equal(await draining, false);
    assert.equal(room.transcription.active.size, 0);
    await waitFor(() => server.clients.size === 0, 1000);
  }
  room.close();
  assert.equal(room.transcription.active.size, 0);
});

test("failed sealed evidence aborts without granting a successor or issuing a winner", async (t) => {
  const { room, turn } = roomFixture();
  t.after(() => room.close());
  const { stream, socket } = inkFixture();
  stream.turnId = turn.id;
  socket.send = () => socket.listeners.get("close")?.(1006, "fault", []);
  room.transcription.ink.set(turn.playerId, stream);
  room.media.audio(
    turn.playerId,
    Buffer.from(
      encodeMicrophone(
        room.game.state.mediaEpoch,
        1,
        room.services.now(),
        new Uint8Array(),
        { purpose: "gameplay", inputEpoch: 1, end: true },
      ),
    ),
  );
  room.game.endTurn(turn.playerId, turn.id, 1);
  await flush();
  assert.equal(room.game.state.phase, "ABORTED");
  assert.equal(room.game.state.turn, null);
  assert.equal(room.game.state.winnerId, null);
  assert.equal(room.game.state.turnIndex, 0);
});
