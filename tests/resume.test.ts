import assert from "node:assert/strict";
import test from "node:test";
import type { AddressInfo } from "node:net";
import { createApp } from "../server/app";
import { services, startRound } from "./fixtures";
import { post } from "./ws-peer";

test("resume retries advance an epoch once; stale requests cannot replace current sockets", async (t) => {
  const app = createApp({ providersReady: () => true, services: services() });
  await new Promise<void>((resolve) =>
    app.server.listen(0, "127.0.0.1", resolve),
  );
  t.after(() => app.close());
  const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  const initial = await post(base, "/api/rooms", { name: "Alex" });
  const request = { ...initial.session, resumeId: crypto.randomUUID() };
  const first = await post(base, "/api/resume", request);
  const room = app.registry.rooms.get(initial.session.code)!;
  const seat = room.seats.get(initial.session.playerId)!;
  let closed = 0;
  const socket = {
    readyState: 1,
    send() {},
    close() {
      closed++;
    },
  } as any;
  seat.sockets.set("control", socket);
  // Settle the readiness change caused by installing this test socket before
  // asserting that idempotent HTTP retries emit no additional game event.
  room.readiness.tick();
  const epoch = room.game.state.mediaEpoch,
    sequence = room.game.state.seq;
  const repeats = await Promise.all([
    post(base, "/api/resume", request),
    post(base, "/api/resume", request),
  ]);
  for (const repeat of repeats) assert.deepEqual(repeat.session, first.session);
  assert.equal(seat.epoch, 2);
  assert.equal(closed, 0);
  assert.equal(room.game.state.mediaEpoch, epoch);
  assert.equal(room.game.state.seq, sequence);
  for (const body of [
    initial.session,
    { ...request, resumeId: crypto.randomUUID() },
  ]) {
    for (const route of ["resume", "leave"]) {
      const response = await fetch(base + "/api/" + route, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      assert.equal(response.status, route === "resume" ? 409 : 401);
      assert.equal(closed, 0);
      assert.equal(seat.epoch, 2);
    }
  }
  const second = await post(base, "/api/resume", first.session);
  assert.equal(second.session.connectionEpoch, 3);
  assert.equal(closed, 1);
  seat.sockets.set("control", socket);
  const stale = await fetch(base + "/api/resume", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  assert.equal(stale.status, 409);
  assert.equal(closed, 1);
  assert.equal(seat.sockets.get("control"), socket);
  assert.equal(seat.epoch, 3);
  const future = await fetch(base + "/api/resume", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...initial.session, connectionEpoch: 99 }),
  });
  assert.equal(future.status, 409);
  assert.equal(closed, 1);
  const oldLeave = await fetch(base + "/api/leave", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  assert.equal(
    oldLeave.status,
    401,
    "a newer legacy resume also revokes old cancellation authority",
  );
  assert.equal(seat.sockets.get("control"), socket);
});

for (const order of ["leave-first", "resume-first"] as const) {
  test(`${order}: pending resume departure aborts once and late requests cannot restore the seat`, async (t) => {
    const app = createApp({ providersReady: () => true, services: services() });
    await new Promise<void>((resolve) =>
      app.server.listen(0, "127.0.0.1", resolve),
    );
    t.after(() => app.close());
    const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
    const initial = await post(base, "/api/rooms", { name: "Alex" });
    await post(base, "/api/join", { name: "Sam", code: initial.session.code });
    const room = app.registry.rooms.get(initial.session.code)!;
    startRound(room.game);
    const ledger = structuredClone(room.game.state.ledger);
    const request = { ...initial.session, resumeId: crypto.randomUUID() };
    if (order === "resume-first") {
      await post(base, "/api/resume", request);
      assert.equal(room.seats.get(initial.session.playerId)!.epoch, 2);
    }
    // The client still knows only epoch 1, regardless of response delivery.
    await post(base, "/api/leave", request);
    assert.equal(room.game.state.phase, "ABORTED");
    assert.equal(room.seats.has(initial.session.playerId), false);
    assert.deepEqual(room.game.state.ledger, ledger);
    const sequence = room.game.state.seq;
    for (const route of ["leave", "resume"]) {
      const late = await fetch(base + "/api/" + route, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      assert.equal(late.status, 401);
    }
    assert.equal(room.game.state.seq, sequence);
    assert.equal(room.game.state.recoveryDeadline, null);
  });
}
