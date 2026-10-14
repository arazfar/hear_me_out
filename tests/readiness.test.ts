import assert from "node:assert/strict";
import test from "node:test";
import { RoomController } from "../server/rooms/room";
import { seat, services, evidence, flush } from "./fixtures";
import { encodeMicrophone } from "../shared/media";
import {
  commandSchema,
  type Command,
  type GameEvent,
} from "../shared/protocol";
import type { InkSession } from "../server/providers/ink";

function fixture() {
  let now = 100000,
    frames = 0,
    seq = 0,
    checks = 0;
  let providerConnected = true;
  const messages: any[] = [],
    events: GameEvent[] = [];
  const callbacks = new Map<
    string,
    ConstructorParameters<typeof InkSession>[3]
  >();
  const room = new RoomController(
    "1234",
    services({
      now: () => now,
      transcriptionAvailable: () => true,
      createTranscription: (id, roundId, turnId, handlers) => {
        callbacks.set(id, handlers);
        return {
          turnId,
          roundId,
          connected: providerConnected,
          closing: false,
          failed: false,
          send: () => {},
          close: async () => true,
        };
      },
    }),
  );
  room.game.onEvent = (event) => events.push(event);
  room.send = (_id, message) => {
    messages.push(message);
  };
  const players = [room.game.addPlayer("Alex"), room.game.addPlayer("Sam")];
  room.game.setMediaMode("wss");
  for (const p of players) {
    const s = seat();
    s.sockets.set("audio", {
      readyState: 1,
      send: () => {},
      close: () => {},
    } as any);
    room.seats.set(p.id, s);
  }
  function report(
    id: string,
    changes: Partial<Extract<Command, { type: "media_status" }>> = {},
  ) {
    room.seats.get(id)!.lastAudioAt = now;
    room.readiness.observe(id, {
      type: "media_status",
      captureId: id + ":mic",
      cameraId: id + ":camera",
      mic: true,
      camera: true,
      foreground: true,
      rtc: false,
      localFrames: ++frames,
      remoteFrames: 0,
      mediaEpoch: room.game.state.mediaEpoch,
      ...changes,
    });
    const probe = ++seq;
    room.readiness.sent(id, probe, true);
    room.readiness.received(id, probe, room.game.state.mediaEpoch, true);
    const video = ++seq;
    room.readiness.sent(id, video, false);
    room.readiness.received(
      room.game.other(id).id,
      video,
      room.game.state.mediaEpoch,
    );
  }
  function audio(id: string) {
    room.media.audio(
      id,
      Buffer.from(
        encodeMicrophone(
          room.game.state.mediaEpoch,
          ++seq,
          now,
          new Uint8Array(640).fill(1),
          { purpose: "private", inputEpoch: room.readiness.get(id).inputEpoch },
        ),
      ),
    );
  }
  function pass(id: string) {
    report(id);
    room.readiness.start(id, "check:" + ++checks, id + ":mic");
    audio(id);
    callbacks.get(id)!.segment({
      id: "check-segment",
      playerId: id,
      turnId: null,
      roundId: "",
      sessionEpoch: "test",
      eligible: false,
      source: "voice",
      stableAt: now,
      text: "Bonk, hear me out.",
    });
  }
  function refresh(ms = 0) {
    now += ms;
    players.forEach((p) => report(p.id));
    room.readiness.tick();
  }
  function ready() {
    players.forEach((p) => pass(p.id));
    refresh();
    refresh(1001);
  }
  function round() {
    ready();
    room.game.startMatch();
    room.game.selectTopic();
    room.game.proposeTopic(
      room.game.state.tailsId!,
      "Waffles are better.",
      "Waffles",
      "Pancakes",
      true,
    );
    players.forEach((p) => room.game.confirm(p.id, 1));
  }
  return {
    room,
    players,
    messages,
    events,
    callbacks,
    report,
    pass,
    audio,
    refresh,
    ready,
    round,
    advance: (ms: number) => {
      now += ms;
      room.readiness.tick();
    },
    disconnectProvider: () => {
      providerConnected = false;
    },
  };
}

test("start and rematch require measured capabilities; legacy readiness and typed commands are rejected", () => {
  const f = fixture();
  assert.throws(() => f.room.game.startMatch());
  assert.throws(() => f.room.game.ready(f.players[0].id, true));
  assert(
    !commandSchema.safeParse({
      type: "media_status",
      ready: true,
      cameraOn: true,
      rtc: true,
    }).success,
  );
  assert(
    !commandSchema.safeParse({
      type: "typed_argument",
      turnId: "x",
      text: "Hello",
    }).success,
  );
  f.room.game.state.phase = "MATCH_RESULT";
  assert.throws(() => f.room.game.rematch(f.players[0].id, true));
  f.room.close();
});
test("transport selection must complete before either player can commit to Ready", () => {
  const f = fixture();
  f.ready();
  f.room.game.state.mediaMode = "connecting";
  f.refresh();
  assert(!f.room.game.allMediaReady());
  assert.throws(() => f.room.game.ready(f.players[0].id, true));
  f.room.game.state.mediaMode = "wss";
  f.refresh();
  assert(f.room.game.allMediaReady());
  f.room.close();
});
test("stalled RTC decoding switches to relay while preserving readiness guards", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture();
  f.room.services.setTimeout = setTimeout;
  f.room.services.clearTimeout = clearTimeout;
  f.ready();
  f.room.game.state.mediaMode = "rtc";
  for (const p of f.players) f.room.readiness.get(p.id).remoteAt = -Infinity;
  f.room.readiness.tick();
  assert(!f.room.game.allMediaReady());
  f.room.media.selectMode();
  t.mock.timers.tick(3001);
  assert.equal(f.room.game.state.mediaMode, "wss");
  assert(!f.room.game.allMediaReady());
  f.refresh();
  f.refresh(1001);
  f.refresh(1001);
  assert(f.room.game.allMediaReady());
  f.room.close();
});
test("source interruption cancels a running private check immediately", () => {
  const f = fixture(),
    id = f.players[0].id;
  f.report(id);
  f.room.readiness.start(id, "interrupted", id + ":mic");
  f.report(id, { mic: false, micSource: false });
  assert.equal(f.room.readiness.get(id).setup, "failed");
  assert(!f.room.transcription.ink.has(id));
  assert(
    f.messages.some(
      (m) => m.status === "failed" && m.checkId === "interrupted",
    ),
  );
  f.room.close();
});
test("private speech proof requires captured audio and a final transcript; it cannot create match evidence", () => {
  const f = fixture(),
    id = f.players[0].id;
  f.report(id);
  f.room.readiness.start(id, "silent", id + ":mic");
  f.room.readiness.transcript(id, "Invented result without captured audio");
  assert.equal(f.room.readiness.get(id).passed, false);
  f.pass(id);
  assert.equal(f.room.readiness.get(id).passed, true);
  assert.equal(f.room.game.state.ledger.length, 0);
  assert.deepEqual(f.room.game.state.captions, {});
  assert.equal(f.room.judging.queue.length, 0);
  assert(
    f.messages.some(
      (m) => m.status === "passed" && m.text === "Bonk, hear me out.",
    ),
  );
  f.room.close();
});
test("video receipts must refer to a fresh sent frame with the correct epoch and destination", () => {
  const f = fixture(),
    [a, b] = f.players;
  f.report(a.id);
  assert(!f.room.readiness.received(a.id, 999, 1, true));
  f.room.readiness.sent(a.id, 999, true);
  assert(!f.room.readiness.received(b.id, 999, 1, true));
  assert(!f.room.readiness.received(a.id, 999, 0, true));
  assert(f.room.readiness.received(a.id, 999, 1, true));
  assert(!f.room.readiness.received(a.id, 999, 1, true));
  f.room.readiness.sent(a.id, 1000, true);
  f.advance(3001);
  assert(!f.room.readiness.received(a.id, 1000, 1, true));
  f.room.close();
});
test("silence and normal floor gating stay ready; camera and mic interruptions freeze one shared clock", () => {
  const f = fixture();
  f.round();
  const turn = f.room.game.state.turn!,
    id = turn.playerId;
  const e = evidence(f.room.game);
  f.room.game.registerSegment(e);
  f.room.game.score({
    ...e,
    turnId: turn.id,
    segmentId: e.id,
    criterion: "wit",
    quality: 1,
    reason: "Those syrup pockets earned their keep.",
  });
  const total = f.room.game.player(id).scoreUnits;
  f.refresh(1000);
  assert(f.room.game.allMediaReady());
  f.report(id, { mic: false });
  assert.equal(f.room.game.state.phase, "RECOVERING");
  const remaining = f.room.game.remaining();
  f.report(f.room.game.other(id).id, { camera: false });
  f.report(id);
  f.advance(1000);
  assert.equal(f.room.game.state.phase, "RECOVERING");
  assert.equal(f.room.game.remaining(), remaining);
  f.refresh();
  f.refresh(1001);
  f.refresh(1001);
  assert.equal(f.room.game.state.phase, "ROUND");
  assert.equal(f.room.game.state.turn!.id, turn.id);
  assert.equal(f.room.game.player(id).scoreUnits, total);
  assert.equal(f.room.game.remaining(), remaining);
  f.room.close();
});
test("stale observations and a resumed connection cannot reuse old video receipts", () => {
  const f = fixture();
  f.ready();
  assert(f.room.game.allMediaReady());
  f.advance(3001);
  assert(!f.room.game.allMediaReady());
  f.refresh();
  f.refresh(1001);
  assert(f.room.game.allMediaReady());
  const p = f.players[0];
  f.room.seats.get(p.id)!.epoch++;
  f.room.game.resumePlayer(p.id);
  f.report(p.id);
  assert(!f.room.game.allMediaReady());
  assert(
    f.room.readiness.get(p.id).passed,
    "healthy capture proof survives a transport reconnect",
  );
  f.room.close();
});
test("replaced microphones, cancelled checks, and late provider replies cannot pass a new attempt", () => {
  const f = fixture(),
    id = f.players[0].id;
  f.pass(id);
  f.report(id, { captureId: "replacement" });
  assert(!f.room.readiness.get(id).passed);
  f.room.readiness.start(id, "new", "replacement");
  const old = f.callbacks.get(id)!;
  f.room.readiness.cancel(id, "new");
  old.segment({
    id: "late",
    playerId: id,
    turnId: null,
    roundId: "",
    sessionEpoch: "old",
    eligible: false,
    source: "voice",
    stableAt: Date.now(),
    text: "Old result",
  });
  assert(!f.room.readiness.get(id).passed);
  f.room.close();
});
test("provider connection and speech tests time out without unlocking play", () => {
  const f = fixture(),
    id = f.players[0].id;
  f.report(id);
  f.disconnectProvider();
  f.room.readiness.start(id, "pending", id + ":mic");
  assert(!f.room.readiness.get(id).listening);
  f.advance(10001);
  assert.equal(f.room.readiness.get(id).setup, "failed");
  assert(f.messages.some((m) => m.status === "failed"));
  assert(!f.room.game.allMediaReady());
  f.room.close();
  const g = fixture(),
    other = g.players[0].id;
  g.report(other);
  g.room.readiness.start(other, "silent", other + ":mic");
  g.advance(15001);
  assert.equal(g.room.readiness.get(other).setup, "failed");
  g.room.close();
});
test("transcription loss requires a new private speech check before resuming", () => {
  const f = fixture();
  f.round();
  const id = f.room.game.state.turn!.playerId;
  f.room.transcription.sttFailure(id, f.room.game.state.turn!.id);
  assert.equal(f.room.game.state.phase, "RECOVERING");
  assert(!f.room.readiness.get(id).passed);
  f.refresh(1001);
  assert.equal(f.room.game.state.phase, "RECOVERING");
  f.pass(id);
  f.refresh();
  f.refresh(1001);
  f.refresh(1001);
  // The replacement turn session also qualifies from advancing media reports.
  f.refresh(1001);
  assert.equal(f.room.game.state.phase, "ROUND");
  f.room.close();
});
test("Bonk asides are earned, bounded, once per turn, and never change point totals", () => {
  const f = fixture();
  f.round();
  const e = evidence(f.room.game);
  f.room.game.registerSegment(e);
  const input = {
    ...e,
    turnId: e.turnId!,
    segmentId: e.id,
    criterion: "wit" as const,
    quality: 1,
    reason: "Those syrup pockets earned their keep.",
  };
  assert(f.room.game.score(input));
  assert(!f.room.game.score(input));
  f.room.game.score({ ...input, criterion: "clarity" });
  const cues = f.events.filter((e) => e.type === "bonk_reaction");
  assert.equal(cues.length, 1);
  assert.equal(
    cues[0].type === "bonk_reaction" && cues[0].payload.awardId,
    f.room.game.state.ledger[0].id,
  );
  assert.equal(
    f.room.game.player(e.playerId).scoreUnits,
    f.room.game.state.ledger.reduce((n, s) => n + s.deltaUnits, 0),
  );
  f.room.judging.argumentRevision.set(e.turnId!, 1);
  f.room.judging.reactions.set(e.turnId!, {
    segmentId: e.id,
    text: "Yes. Those syrup pockets earned their keep.",
    revision: 1,
  });
  assert.equal(f.room.judging.latestReaction(e.turnId!), null);
  f.room.close();
});

test("healthy recovery needs two observations; ticking alone cannot pass it", () => {
  const f = fixture();
  f.players.forEach((p) => f.pass(p.id));
  f.refresh();
  f.advance(1100);
  assert(!f.room.game.allMediaReady());
  f.refresh();
  assert(f.room.game.allMediaReady());
  f.room.close();
});
test("source interruption invalidates speech proof while a privacy mute preserves it", () => {
  const f = fixture();
  f.ready();
  const id = f.players[0].id;
  f.report(id, { mic: false, micSource: true });
  assert(f.room.readiness.get(id).passed);
  f.report(id, { mic: false, micSource: false });
  assert(!f.room.readiness.get(id).passed);
  f.refresh(1001);
  assert(!f.room.game.allMediaReady());
  f.room.close();
});
test("frozen camera frames and backgrounding block play independently of speech and echo", () => {
  const f = fixture();
  f.round();
  const id = f.players[0].id,
    localFrames = f.room.readiness.get(id).observation!.localFrames;
  for (let i = 0; i < 4; i++) {
    f.advance(800);
    f.report(id, { localFrames });
    f.report(f.players[1].id);
  }
  assert(f.room.game.player(id).readiness!.blockers.includes("camera"));
  assert.equal(f.room.game.state.phase, "RECOVERING");
  const remaining = f.room.game.remaining();
  f.report(id, { foreground: false });
  assert(f.room.game.player(id).readiness!.blockers.includes("foreground"));
  f.advance(1000);
  assert.equal(f.room.game.remaining(), remaining);
  f.room.close();
});
test("replacement gameplay transcription must connect before recovery opens the clock", () => {
  const f = fixture();
  f.round();
  const id = f.room.game.state.turn!.playerId;
  f.report(id, { camera: false });
  const remaining = f.room.game.remaining();
  f.disconnectProvider();
  f.refresh();
  f.refresh(1001);
  const stream = f.room.transcription.ink.get(id)!;
  assert.equal(stream.turnId, f.room.game.state.turn!.id);
  assert(!stream.connected);
  f.refresh(1001);
  assert.equal(f.room.game.state.turn!.deadline, null);
  assert(f.room.game.state.turn!.pausedReason);
  assert.equal(f.room.game.remaining(), remaining);
  stream.connected = true;
  f.refresh();
  f.refresh(1001);
  assert.equal(f.room.game.state.phase, "ROUND");
  assert.equal(f.room.game.remaining(), remaining);
  f.room.close();
});

test("a private check owns reconnect transcription; private callbacks never become turn evidence", async () => {
  const f = fixture();
  f.round();
  const { room } = f,
    id = room.game.state.turn!.playerId;
  room.readiness.failed(id);
  f.report(id);
  room.readiness.start(id, "repair", id + ":mic");
  const old = f.callbacks.get(id)!,
    deadline = room.readiness.get(id).checkDeadline;
  const frozen = {
    remaining: room.game.remaining(),
    turn: room.game.state.turn!.id,
    ledger: structuredClone(room.game.state.ledger),
    recovery: room.game.state.recoveryDeadline,
  };
  room.disconnect(id);
  room.seats.get(id)!.epoch++;
  room.game.connectPlayer(id);
  f.advance(1000);
  // Even an explicit request for the preserved floor cannot replace the check.
  room.transcription.rotate(id, frozen.turn);
  f.refresh();
  assert.equal(room.transcription.ink.get(id)!.turnId, null);
  assert.equal(room.readiness.get(id).checkDeadline, deadline);
  old.segment({ ...evidence(room.game, "old-private"), text: "Old check" });
  assert.equal(room.readiness.get(id).passed, false);
  const current = f.callbacks.get(id)!;
  f.audio(id);
  current.caption("Bonk, hear", false);
  current.caption("Bonk, hear me out.", true);
  current.start();
  current.end();
  // Purpose owns eligibility, even if an adapter supplies turn-shaped data.
  current.segment({
    ...evidence(room.game, "private"),
    text: "Bonk, hear me out.",
  });
  assert.equal(room.readiness.get(id).passed, true);
  assert.deepEqual(room.game.state.captions, {});
  assert.equal(room.game.turns.get(frozen.turn)!.segments.size, 0);
  assert.equal(room.judging.queue.length, 0);
  assert.deepEqual(room.game.state.claims, []);
  assert.deepEqual(room.game.state.ledger, frozen.ledger);
  assert.equal(room.game.remaining(), frozen.remaining);
  assert.equal(room.game.state.recoveryDeadline, frozen.recovery);
  await flush();
  f.refresh(1001);
  f.refresh(1001);
  f.refresh(1001);
  assert.equal(room.game.state.phase, "ROUND");
  assert.equal(room.game.state.turn!.id, frozen.turn);
  assert.equal(room.transcription.ink.get(id)!.turnId, frozen.turn);
  assert.equal(room.game.remaining(), frozen.remaining);
  room.judging.drain = async () => {};
  const spoken = evidence(room.game, "real-argument");
  f.callbacks.get(id)!.segment(spoken);
  assert(
    room.game.score({
      ...spoken,
      turnId: frozen.turn,
      segmentId: spoken.id,
      criterion: "reasoning",
      quality: 3,
      reason: "Those syrup pockets spread the sweetness.",
    }),
  );
  assert(room.game.player(id).scoreUnits > 0);
  room.close();
});

test("private PCM requires the matching connected check session", () => {
  const f = fixture(),
    id = f.players[0].id;
  f.report(id);
  f.room.readiness.start(id, "check", id + ":mic");
  const actual = f.room.transcription.ink.get(id)!;
  let sent = 0;
  f.room.transcription.ink.set(id, {
    ...actual,
    turnId: "wrong-turn",
    send: () => {
      sent++;
    },
  });
  f.audio(id);
  assert.equal(sent, 0);
  assert.equal(f.room.readiness.get(id).heard, false);
  f.room.transcription.ink.set(id, actual);
  f.room.close();
});

test("a cached listening result cannot prompt against an obsolete or disconnected provider", () => {
  const f = fixture(),
    id = f.players[0].id;
  f.report(id);
  f.room.readiness.start(id, "check", id + ":mic");
  const count = f.messages.length,
    deadline = f.room.readiness.get(id).checkDeadline;
  f.room.seats.get(id)!.epoch++;
  f.room.readiness.start(id, "check", id + ":mic");
  assert.equal(f.messages.length, count);
  f.room.transcription.rotate(id);
  f.room.transcription.ink.get(id)!.connected = false;
  f.room.readiness.start(id, "check", id + ":mic");
  assert.equal(f.messages.length, count);
  assert.equal(f.room.readiness.get(id).checkDeadline, deadline);
  f.room.close();
});

test("reconnected private checks retain provider and speech deadlines, including at the boundary", () => {
  for (const listening of [false, true]) {
    const f = fixture(),
      id = f.players[0].id;
    f.report(id);
    if (!listening) f.disconnectProvider();
    f.room.readiness.start(id, "deadline", id + ":mic");
    const r = f.room.readiness.get(id),
      deadline = r.checkDeadline;
    for (let i = 0; i < 3; i++) {
      f.advance(1000);
      f.room.transcription.disconnect(id);
      f.room.seats.get(id)!.epoch++;
      f.room.transcription.rotate(id);
      f.report(id);
      f.room.readiness.start(id, "deadline", id + ":mic");
      assert.equal(r.checkDeadline, deadline);
      assert.equal(r.attempts.length, 1);
    }
    const stream = f.room.transcription.ink.get(id)!;
    stream.connected = true;
    f.advance((listening ? 15000 : 10000) - 3000);
    assert.equal(r.setup, "failed");
    assert.equal(r.listening, false);
    assert.equal(r.passed, false);
    assert.equal(f.room.transcription.ink.has(id), false);
    const message = r.result;
    f.room.readiness.start(id, "deadline", id + ":mic");
    assert.deepEqual(f.messages.at(-1), message);
    assert.equal(r.checkDeadline, 0);
    f.room.close();
  }
});

test("lost private results replay without providers or deadlines and source failure revokes success", () => {
  const f = fixture(),
    id = f.players[0].id;
  f.pass(id);
  const r = f.room.readiness.get(id),
    checkId = r.checkId;
  const stream = f.room.transcription.ink.get(id),
    count = r.attempts.length;
  // The result is still available after a successful check has reopened play.
  f.room.game.state.phase = "ROUND";
  f.room.readiness.start(id, checkId, id + ":mic");
  assert.equal(f.messages.at(-1).status, "passed");
  assert.equal(f.messages.at(-1).text, "Bonk, hear me out.");
  assert.equal(f.room.transcription.ink.get(id), stream);
  assert.equal(r.attempts.length, count);
  assert.equal(r.checkDeadline, 0);
  f.report(id, { micSource: false, mic: false });
  assert.equal(r.result, undefined);
  assert.equal(r.checkId, "");
  assert.equal(r.passed, false);
  f.room.close();
});

test("private reconnect callbacks lose ownership on replacement, cancellation, and departure", () => {
  for (const interruption of ["replacement", "cancel", "leave"] as const) {
    const f = fixture(),
      id = f.players[0].id;
    f.report(id);
    f.room.readiness.start(id, "private", id + ":mic");
    f.audio(id);
    const callback = f.callbacks.get(id)!;
    if (interruption === "replacement") f.report(id, { captureId: "new-mic" });
    else if (interruption === "cancel") f.room.readiness.cancel(id, "private");
    else f.room.leave(id);
    callback.caption("Private", true);
    callback.segment({
      id: "private",
      playerId: id,
      roundId: "",
      turnId: null,
      sessionEpoch: "old",
      text: "Private",
      stableAt: 100000,
      source: "voice",
      eligible: false,
    });
    assert.equal(f.room.readiness.records.get(id)?.passed ?? false, false);
    assert.deepEqual(f.room.game.state.captions, {});
    assert.equal(f.room.judging.queue.length, 0);
    f.room.close();
  }
});

test("a pre-check gameplay session may still drain its legitimate final evidence", () => {
  const f = fixture();
  f.round();
  const id = f.room.game.state.turn!.playerId;
  f.room.transcription.rotate(id, f.room.game.state.turn!.id);
  const gameplay = f.callbacks.get(id)!;
  f.room.readiness.failed(id);
  f.report(id);
  f.room.readiness.start(id, "repair", id + ":mic");
  const original = evidence(f.room.game, "before-interruption");
  gameplay.segment(original);
  assert(f.room.game.turns.get(original.turnId!)!.segments.has(original.id));
  assert.deepEqual(f.room.judging.queue, [original]);
  assert.equal(f.room.readiness.get(id).passed, false);
  f.room.close();
});
test("long reasons remain in the ledger without creating noisy Bonk asides", () => {
  const f = fixture();
  f.round();
  const e = evidence(f.room.game);
  f.room.game.registerSegment(e);
  f.room.game.score({
    ...e,
    turnId: e.turnId!,
    segmentId: e.id,
    criterion: "reasoning",
    quality: 4,
    reason:
      "This explanation has far too many words for a passing aside beside Bonk.",
  });
  assert.equal(f.room.game.state.ledger.length, 1);
  assert(!f.events.some((e) => e.type === "bonk_reaction"));
  f.room.close();
});

for (const mode of ["rtc", "wss"] as const) {
  test(`${mode}: a cached preview frame cannot qualify recovery or consume turn time`, () => {
    const f = fixture();
    f.round();
    f.room.game.setMediaMode(mode);
    const id = f.room.game.state.turn!.playerId;
    const other = f.room.game.other(id).id;
    f.report(id, { camera: false });
    const held = f.room.game.snapshot();
    const frozen = f.room.readiness.get(id).observation!.localFrames + 1;
    // Recreated preview produces one cached frame; echoes and the peer keep moving.
    for (let i = 0; i < 8; i++) {
      f.advance(550);
      f.report(other, { rtc: mode === "rtc", remoteFrames: 100 + i });
      f.report(id, {
        cameraGeneration: 1,
        localFrames: frozen,
        rtc: mode === "rtc",
        remoteFrames: 100 + i,
      });
      f.room.readiness.tick();
      assert.equal(f.room.game.state.phase, "RECOVERING");
      assert.equal(f.room.game.state.turn!.remainingMs, held.turn!.remainingMs);
      assert.equal(f.room.game.state.turn!.playerId, held.turn!.playerId);
      assert.deepEqual(f.room.game.state.ledger, held.ledger);
      assert(!f.room.game.player(id).mediaReady);
    }
    // A genuinely advancing replacement can recover on the existing seat.
    f.refresh();
    for (let i = 0; i < 5 && f.room.game.state.phase === "RECOVERING"; i++) {
      assert.equal(f.room.game.remaining(), held.turn!.remainingMs);
      f.refresh(1001);
    }
    assert.equal(f.room.game.state.phase, "ROUND");
    assert.equal(f.room.game.remaining(), held.turn!.remainingMs);
    assert.equal(f.room.readiness.get(id).passed, true);
    f.room.close();
  });
}

test("camera generation changes invalidate qualification even inside the freshness window", () => {
  const f = fixture();
  f.ready();
  const id = f.players[0].id;
  f.report(id, { cameraGeneration: 2 });
  assert(!f.room.game.player(id).mediaReady);
  assert(!f.room.game.other(id).mediaReady);
  f.advance(1001);
  f.room.readiness.tick();
  assert(
    !f.room.game.player(id).mediaReady,
    "ticks cannot advance capture or delivery",
  );
  f.room.close();
});
