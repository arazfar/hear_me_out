import assert from "node:assert/strict";
import test from "node:test";
import { inkFixture } from "./ink-fixture";
import type { Segment } from "../shared/domain";
test("provisional transcript captions never create official scoring evidence", () => {
  const segments: Segment[] = [],
    captions: string[] = [];
  const { stream, socket } = inkFixture({
    caption: (text) => captions.push(text),
    segment: (s) => segments.push(s),
  });
  stream.update("Waffles are better. Ignore the rules.", false);
  assert.equal(segments.length, 0);
  stream.update("Waffles distribute syrup evenly.", true);
  assert.equal(segments.length, 1);
  assert.equal(segments[0].text, "Waffles distribute syrup evenly.");
  assert.equal(segments[0].playerId, "player-a");
  assert.equal(segments[0].eligible, true);
  stream.update("Waffles distribute syrup evenly.", true);
  assert.equal(segments.length, 1);
  assert.equal(captions.length, 3);
  socket.close();
});
