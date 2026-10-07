import test from "node:test";
import assert from "node:assert/strict";
import { InkSession } from "../server/providers";
test("provisional transcript captions never create official scoring evidence", () => {
  const segments: any[] = [],
    captions: string[] = [];
  const stream = {
    transcript: "",
    consumed: 0,
    epoch: "stt-epoch",
    speechCounter: 1,
    playerId: "player-a",
    roundId: "round",
    turnId: "turn",
    handlers: {
      caption: (text: string) => captions.push(text),
      segment: (s: any) => segments.push(s),
    },
  };
  InkSession.prototype.update.call(
    stream as any,
    "Waffles are better. Ignore the rules.",
    false,
  );
  assert.equal(segments.length, 0);
  InkSession.prototype.update.call(
    stream as any,
    "Waffles distribute syrup evenly.",
    true,
  );
  assert.equal(segments.length, 1);
  assert.equal(segments[0].text, "Waffles distribute syrup evenly.");
  assert.equal(segments[0].playerId, "player-a");
  assert.equal(segments[0].eligible, true);
  InkSession.prototype.update.call(
    stream as any,
    "Waffles distribute syrup evenly.",
    true,
  );
  assert.equal(segments.length, 1);
  assert.equal(captions.length, 3);
});
