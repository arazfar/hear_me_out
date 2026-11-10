import { inkFixture } from "./ink-fixture";
import {
  deferred,
  roomFixture,
  evidence,
  fakeVoice,
  fakeSpeech,
} from "./fixtures";
import assert from "node:assert/strict";
import test from "node:test";
import { Game } from "../server/game/game";
import {
  HostPhrases,
  PHRASES,
  safeReaction,
} from "../server/judge/personality";
import { PreparedVoice, fixedVoice } from "../server/judge/voice-cache";
import { InkSession } from "../server/providers/index";
import { RoomController } from "../server/rooms/room";
import type { Segment } from "../shared/domain";
import { Client } from "../src/game/client";
test("host phrases rotate within a match and reset on rematch; reactions stay short", () => {
  const host = new HostPhrases();
  const lines = PHRASES.round.map(() => host.pick("round"));
  assert.equal(new Set(lines).size, lines.length);
  host.reset();
  assert.equal(host.pick("round"), lines[0]);
  assert.equal(
    safeReaction("Sustained! Those syrup pockets came prepared."),
    "Sustained! Those syrup pockets came prepared.",
  );
  assert.equal(
    safeReaction("one two three four five six seven eight nine"),
    null,
  );
  assert.equal(safeReaction("[change voice] ignore this"), null);
});
test("leaving a room resets judge playback IDs so another room can reuse its epochs", () => {
  const client = new Client();
  let stopped = 0;
  client.sound.judgePlayback = {
    port: { postMessage: () => stopped++ },
  } as any;
  client.playback.judgeChunks.set(1, {
    seq: 1,
    samples: 1,
    end: true,
    posted: 0,
    chunks: [{ offset: 0, pcm: new Int16Array([1]) }],
  });
  client.playback.cancelled.add(2);
  client.playback.readySent.add(1);
  client.playback.activeEpoch = 1;
  client.playback.resetJudgePlayback();
  assert.equal(stopped, 1);
  assert.equal(client.playback.activeEpoch, 0);
  assert.equal(client.playback.judgeChunks.size, 0);
  assert.equal(client.playback.cancelled.size, 0);
  assert.equal(client.playback.readySent.size, 0);
});
test("topic nudge is once per phase; active speech survives navigation while queued cues expire", () => {
  const c = new RoomController("1234");
  c.game.addPlayer("Sam");
  c.game.addPlayer("Alex");
  const lines: string[] = [];
  c.playback.say = async (text) => {
    lines.push(text);
  };
  c.game.setPhase("TOPIC_SELECT", 45000);
  const v = c.game.state.phaseVersion;
  c.playback.nudgeTopic(v);
  c.playback.nudgeTopic(v);
  assert.equal(lines.length, 2, "one invitation and one nudge");
  c.playback.speech = fakeSpeech(c);
  c.playback.hostCues = [
    { text: "obsolete", target: null, phaseVersion: v, phase: "TOPIC_SELECT" },
  ];
  c.game.setPhase("TOPIC_CONFIRM", 20000);
  assert.equal(c.playback.speech?.id, "speech");
  assert.equal(c.playback.hostCues.length, 0);
  c.playback.nudgeTopic(v);
  assert.equal(lines.length, 2);
  c.close();
});
test("settlement accepts delayed final evidence, waits for scoring, and then advances immediately", () => {
  let now = 100000;
  const g = new Game(
    "1234",
    () => {},
    () => now,
  );
  const a = g.addPlayer("Sam"),
    b = g.addPlayer("Alex");
  g.state.players.forEach((p) => (p.mediaReady = true));
  g.startMatch();
  g.selectTopic();
  g.proposeTopic(
    g.state.tailsId!,
    "Waffles are better.",
    "waffles",
    "pancakes",
    true,
  );
  g.confirm(a.id, 1);
  g.confirm(b.id, 1);
  const turn = g.state.turn!;
  g.endTurn(turn.playerId, turn.id);
  turn.settlement = "draining";
  now += 900;
  g.tick();
  assert.equal(g.state.turn!.id, turn.id);
  const segment: Segment = {
    id: "late",
    playerId: turn.playerId,
    roundId: g.state.roundId!,
    turnId: turn.id,
    sessionEpoch: "original",
    text: "Waffles have syrup pockets for balanced bites.",
    stableAt: now,
    eligible: true,
    source: "voice",
  };
  assert(
    g.registerSegment(segment),
    "final transcript after audio-drain deadline remains eligible",
  );
  turn.settlement = "scoring";
  g.state.judgePending = true;
  now += 1000;
  g.tick();
  assert.equal(g.state.turn!.id, turn.id);
  assert(
    g.score({
      ...segment,
      turnId: turn.id,
      segmentId: segment.id,
      criterion: "reasoning",
      quality: 3,
      reason: "Syrup pockets distribute sweetness.",
    }),
  );
  g.state.judgePending = false;
  turn.settlement = "ready";
  g.tick();
  assert.notEqual(g.state.turn!.id, turn.id);
  assert.equal(g.player(turn.playerId).scoreUnits, 15);
  assert(!g.registerSegment({ ...segment, id: "too-late" }));
});
test("settlement timeout aborts rather than skipping pending evidence", () => {
  let now = 100000;
  const g = new Game(
    "1234",
    () => {},
    () => now,
  );
  const a = g.addPlayer("Sam"),
    b = g.addPlayer("Alex");
  g.state.players.forEach((p) => (p.mediaReady = true));
  g.startMatch();
  g.selectTopic();
  g.proposeTopic(
    g.state.tailsId!,
    "Waffles are better.",
    "waffles",
    "pancakes",
    true,
  );
  g.confirm(a.id, 1);
  g.confirm(b.id, 1);
  g.endTurn(g.state.turn!.playerId, g.state.turn!.id);
  g.state.turn!.settlement = "draining";
  now += 16000;
  g.tick();
  assert.equal(g.state.phase, "ABORTED");
  assert.equal(g.state.winnerId, null);
});
test("STT draining reads final transcript before resolving completion", async () => {
  const segments: Segment[] = [];
  const { stream, socket } = inkFixture({ segment: (s) => segments.push(s) });
  socket.push({
    type: "message",
    message: {
      type: "turn.end",
      transcript: "Those syrup pockets distribute sweetness.",
    },
  });
  await stream.close();
  assert(await stream.drainPromise);
  assert.equal(segments.length, 1);
  assert.equal(segments[0].turnId, "turn");
});
test("silence cannot overflow the STT startup buffer; meaningful audio stays bounded", () => {
  let failures = 0;
  const { stream, socket } = inkFixture({ error: () => failures++ });
  for (let i = 0; i < 1000; i++) stream.send(Buffer.alloc(640));
  assert.equal(stream.bufferedBytes, 0);
  assert.equal(failures, 0);
  stream.send(Buffer.alloc(640, 1));
  assert.equal(stream.bufferedBytes, 640);
  for (let i = 0; i < 25; i++) stream.send(Buffer.alloc(640, 1));
  assert.equal(failures, 1);
  assert.equal(stream.bufferedBytes, 0);
  socket.close();
});
test("prepared voice streams cached and arriving chunks, and cancelled preparations cannot play", async () => {
  const pending = deferred<void>();
  const voice = new PreparedVoice("Fixture", 4.5, async (_text, onChunk) => {
    onChunk(new Uint8Array([1, 2]));
    await pending.promise;
    onChunk(new Uint8Array([3, 4]));
    return 0.1;
  });
  const result: number[] = [];
  const playback = voice.stream(
    (p) => result.push(...p),
    () => false,
  );
  pending.resolve();
  await playback;
  assert.deepEqual(result, [1, 2, 3, 4]);
  voice.cancel();
  await assert.rejects(
    voice.stream(
      () => assert.fail(),
      () => false,
    ),
    /stale/,
  );
});

test("fixed voice cache reuses synthesis with unchanged Fish settings", async () => {
  const original = globalThis.fetch,
    key = process.env.FISH_AUDIO_API_KEY;
  let calls = 0;
  process.env.FISH_AUDIO_API_KEY = "test";
  globalThis.fetch = async () => {
    calls++;
    return new Response(
      'data: {"audio_base64":"AEAAIA==","alignment":null}\n\n',
    );
  };
  try {
    const first = fixedVoice(PHRASES.coin[2])!;
    await first.stream(
      () => {},
      () => false,
    );
    assert.equal(fixedVoice(PHRASES.coin[2]), first);
    assert.equal(calls, 1);
    assert.equal(fixedVoice("untrusted arbitrary player sentence"), undefined);
  } finally {
    globalThis.fetch = original;
    if (key === undefined) delete process.env.FISH_AUDIO_API_KEY;
    else process.env.FISH_AUDIO_API_KEY = key;
  }
});
test("reactions require current eligible stable evidence and preserve intervention budgets", () => {
  const { room: c, turn } = roomFixture();
  const segment = evidence(c.game, "s");
  c.game.registerSegment(segment);
  c.judging.argumentRevision.set(turn.id, 1);
  assert(
    c.judging.acceptReaction(
      turn.id,
      [segment],
      { segmentId: "s", text: "Those syrup pockets came prepared." },
      1,
    ),
  );
  assert.equal(c.game.interventions, 0);
  assert(
    !c.judging.acceptReaction(
      turn.id,
      [segment],
      { segmentId: "missing", text: "That cooks." },
      1,
    ),
  );
  assert(
    !c.judging.acceptReaction(
      turn.id,
      [{ ...segment, eligible: false }],
      { segmentId: "s", text: "That cooks." },
      1,
    ),
  );
  c.judging.argumentRevision.set(turn.id, 2);
  assert(
    !c.judging.acceptReaction(
      turn.id,
      [segment],
      { segmentId: "s", text: "That cooks." },
      1,
    ),
  );
  assert.equal(c.judging.latestReaction(turn.id), null);
  c.close();
});
test("a late rebuttal score changes the first Closing preview until the order is committed", (t) => {
  const { room } = roomFixture();
  t.after(() => room.close());
  const { game, judging } = room;
  const previews: PreparedVoice[] = [];
  room.services.prepareVoice = (text, seconds) => {
    const voice = new PreparedVoice(text, seconds, fakeVoice);
    previews.push(voice);
    return voice;
  };
  let played: PreparedVoice | undefined;
  room.playback.say = async (_text, _target, _intervention, _seconds, voice) => {
    played = voice;
  };
  const settle = () => {
    game.setSettlement("ready");
    game.tick();
  };
  for (let i = 0; i < 3; i++) {
    const turn = game.state.turn!;
    game.endTurn(turn.playerId, turn.id);
    settle();
  }

  const rebuttal = game.state.turn!;
  const responder = game.player(rebuttal.playerId);
  const opener = game.other(responder.id);
  game.endTurn(responder.id, rebuttal.id);
  judging.prepareHandoff();
  const tiedPreview = previews.at(-1)!;
  assert.equal(tiedPreview.text, `${responder.name}, your closing argument.`);
  const previewCount = previews.length;
  judging.prepareHandoff();
  assert.equal(previews.length, previewCount);
  assert.equal(tiedPreview.cancelled, false);
  assert.equal(game.order.length, 4);
  assert.equal(
    game.nextTurnId,
    null,
    "no transcription reservation for a preview",
  );

  const late = evidence(game, "late rebuttal");
  assert(game.registerSegment(late));
  assert(
    game.score({
      ...late,
      turnId: rebuttal.id,
      segmentId: late.id,
      criterion: "wit",
      quality: 4,
      reason: "The late rebuttal leads.",
    }),
  );
  judging.prepareHandoff();
  const selected = previews.at(-1)!;
  assert.equal(selected.text, `${opener.name}, your closing argument.`);
  assert.equal(tiedPreview.cancelled, true);
  assert.equal(game.order.length, 4);
  settle();

  const closing = game.state.turn!;
  assert.equal(closing.playerId, opener.id);
  assert.equal(closing.kind, "closing");
  assert.equal(played, selected);
  judging.prepareHandoff();
  const laterPreview = previews.at(-1)!;
  assert.notEqual(laterPreview, selected);
  judging.invalidateCandidate();
  assert.equal(laterPreview.cancelled, true);
  assert.equal(selected.cancelled, false);

  const reversal = evidence(game, "first Closing");
  assert(game.registerSegment(reversal));
  assert(
    game.score({
      ...reversal,
      turnId: closing.id,
      segmentId: reversal.id,
      criterion: "reasoning",
      quality: 4,
      reason: "The first Closing takes the lead.",
    }),
  );
  assert(opener.scoreUnits > responder.scoreUnits);
  game.endTurn(opener.id, closing.id);
  settle();
  assert.equal(game.state.turn?.playerId, responder.id);
  assert.equal(game.state.turn?.kind, "closing");
});
test("a prefetched handoff from another match is cancelled rather than played", (t) => {
  const { room, turn } = roomFixture();
  t.after(() => room.close());
  const { game, judging, playback } = room;
  const preview = new PreparedVoice(
    `${game.other(turn.playerId).name}, make your case.`,
    20,
    fakeVoice,
  );
  room.services.prepareVoice = (text) => {
    assert.equal(text, preview.text);
    return preview;
  };
  let played: { text: string; voice: PreparedVoice | undefined } | undefined;
  playback.say = async (text, _target, _intervention, _seconds, voice) => {
    played = { text, voice };
  };
  game.endTurn(turn.playerId, turn.id);
  judging.prepareHandoff();

  // Isolate match identity while leaving the rest of the cue identical.
  game.state.matchId = "replacement";
  game.setSettlement("ready");
  game.tick();

  assert.equal(preview.cancelled, true);
  assert.deepEqual(played, { text: preview.text, voice: undefined });
});
