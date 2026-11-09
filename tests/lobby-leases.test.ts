import assert from "node:assert/strict";
import test from "node:test";
import type { AddressInfo } from "node:net";
import { WebSocket } from "ws";
import { createApp } from "../server/app";
import { createRegistry } from "../server/rooms/registry";
import { services } from "./fixtures";
import { post, waitFor } from "./ws-peer";
import { PROTOCOL_VERSION } from "../shared/protocol";

test("lobby leases retain connected permission waits and expire partial or abandoned reservations", async (t) => {
  let now = 100000;
  const registry = createRegistry(services({ now: () => now }));
  const room = registry.createRoom("1234");
  t.after(() => room.close());
  registry.byId.set(room.game.state.roomId, room);
  const host = registry.session(room, "Host"),
    friend = registry.session(room, "Friend");
  assert.equal(room.game.player(friend.playerId).connected, false);
  const socket = {
    readyState: WebSocket.OPEN,
    send() {},
    close() {},
  } as unknown as WebSocket;
  for (const channel of ["control", "audio", "video"])
    room.seats.get(host.playerId)!.sockets.set(channel, socket);
  room.connect(host.playerId);
  room.seats.get(friend.playerId)!.sockets.set("control", socket);
  room.connect(friend.playerId);
  assert.equal(room.seats.get(host.playerId)!.lobbyDeadline, null);
  assert.equal(room.seats.get(friend.playerId)!.lobbyDeadline, 160000);
  const epoch = room.game.state.mediaEpoch;
  now += 60000;
  room.tick();
  assert.equal(room.seats.size, 1);
  assert.equal(room.game.player(host.playerId).connected, true);
  assert(room.game.state.mediaEpoch > epoch);
  assert.throws(() =>
    registry.authenticate(friend.roomId, friend.playerId, friend.token),
  );
  const replacement = registry.session(room, "Replacement");
  assert.notEqual(replacement.playerId, friend.playerId);
  assert.equal(room.game.state.mediaMode, "connecting");
  assert.equal(room.game.player(host.playerId).mediaReady, false);
  room.leave(friend.playerId);
  assert(room.seats.has(replacement.playerId));
});

test("resume and partial socket authentication cannot extend a lobby lease; complete current epoch can", async (t) => {
  let now = 100000;
  const runtime = createApp({ services: services({ now: () => now }) });
  t.after(() => runtime.close());
  await new Promise<void>((resolve) =>
    runtime.server.listen(0, "127.0.0.1", resolve),
  );
  const base = `http://127.0.0.1:${(runtime.server.address() as AddressInfo).port}`;
  const initial = await post(base, "/api/rooms", { name: "Host" });
  const room = runtime.registry.rooms.get(initial.session.code)!;
  let session = initial.session;
  const sockets: WebSocket[] = [];
  async function connect(channel: string) {
    const socket = new WebSocket(
      base.replace("http", "ws") + "/socket/" + channel,
    );
    sockets.push(socket);
    await new Promise<void>((resolve) => socket.once("open", resolve));
    const { code: _code, ...auth } = session;
    socket.send(
      JSON.stringify({
        ...auth,
        type: "auth",
        protocolVersion: PROTOCOL_VERSION,
      }),
    );
    await waitFor(
      () =>
        room.seats.get(session.playerId)?.sockets.has(channel) ||
        socket.readyState === WebSocket.CLOSED,
    );
    return socket;
  }
  t.after(() => sockets.forEach((socket) => socket.terminate()));
  now += 30000;
  session = (
    await post(base, "/api/resume", {
      ...session,
      resumeId: crypto.randomUUID(),
    })
  ).session;
  await connect("control");
  await connect("audio");
  assert.equal(room.seats.get(session.playerId)!.lobbyDeadline, 160000);
  assert.equal(room.game.player(session.playerId).connected, false);
  now = 159999;
  const video = await connect("video");
  await waitFor(() => room.game.player(session.playerId).connected);
  assert.equal(room.seats.get(session.playerId)!.lobbyDeadline, null);
  now += 100000;
  room.tick();
  assert(room.seats.has(session.playerId));
  video.close();
  await waitFor(() => !room.game.player(session.playerId).connected);
  const deadline = room.seats.get(session.playerId)!.lobbyDeadline;
  now += 10000;
  const resume = { ...session, resumeId: crypto.randomUUID() };
  session = (await post(base, "/api/resume", resume)).session;
  await post(base, "/api/resume", resume);
  await connect("control");
  assert.equal(room.seats.get(session.playerId)!.lobbyDeadline, deadline);
  now = deadline!;
  const expired = await fetch(base + "/api/resume", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(session),
  });
  assert.equal(expired.status, 401);
  assert.equal(room.seats.size, 0);
  assert.equal(room.transcription.active.size, 0);
});
