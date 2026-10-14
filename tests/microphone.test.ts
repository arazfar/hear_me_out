import assert from "node:assert/strict";
import test from "node:test";
import { encodeMicrophone } from "../shared/media";
import { roomFixture, fakeTranscription } from "./fixtures";

test("capture-time ownership rejects replay, stale grants, private and off-turn speech while relay conversation continues", () => {
  let now = 100000;
  const { room, turn } = roomFixture({ now: () => now });
  room.game.state.mediaMode = "wss";
  const spoken: Buffer[] = [],
    forwarded: Buffer[] = [];
  room.transcription.ink.set(
    turn.playerId,
    fakeTranscription(turn.id, room.game.state.roundId!, (pcm) =>
      spoken.push(pcm),
    ),
  );
  room.media.forward = (_id, _channel, raw) => forwarded.push(raw);
  const packet = (
    seq: number,
    inputEpoch = turn.inputEpoch!,
    purpose: "gameplay" | "social" | "private" = "gameplay",
    capturedAt = now,
  ) =>
    Buffer.from(
      encodeMicrophone(
        room.game.state.mediaEpoch,
        seq,
        capturedAt,
        new Uint8Array(640).fill(1),
        { purpose, inputEpoch },
      ),
    );
  room.media.audio(turn.playerId, packet(1));
  assert.equal(spoken.filter((p) => p.some((x) => x)).length, 1);
  assert.equal(forwarded.length, 1);
  room.media.audio(turn.playerId, packet(1));
  assert.equal(spoken.length, 1, "replays never reach STT");
  room.media.audio(turn.playerId, packet(2, 999));
  room.media.audio(turn.playerId, packet(3, 0, "social"));
  room.media.audio(turn.playerId, packet(4, 2, "private"));
  room.media.audio(room.game.other(turn.playerId).id, packet(1));
  assert.equal(spoken.filter((p) => p.some((x) => x)).length, 1);
  assert.equal(
    forwarded.length,
    4,
    "off-turn friends still converse; private packets never forward",
  );
  now += 1500;
  room.media.audio(
    turn.playerId,
    packet(5, turn.inputEpoch, "gameplay", now - 1000),
  );
  assert.equal(
    spoken.filter((p) => p.some((x) => x)).length,
    2,
    "late valid evidence is retained",
  );
  assert.equal(
    forwarded.length,
    4,
    "stale conversation cannot accumulate playback delay",
  );
  room.close();
});
