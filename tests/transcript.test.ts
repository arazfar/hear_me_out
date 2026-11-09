import assert from "node:assert/strict";
import test from "node:test";
import { inkFixture } from "./ink-fixture";
import { flush } from "./fixtures";
import type { Segment } from "../shared/domain";
test("provisional captions stay out of scoring and each final utterance is counted once", async (t) => {
  const segments: Segment[] = [],
    captions: [text: string, final: boolean][] = [];
  const { stream, socket } = inkFixture({
    caption: (text, final) => captions.push([text, final]),
    segment: (s) => segments.push(s),
  });
  t.after(() => stream.close());
  const receive = (type: string, transcript?: string) => {
    socket.push({ type: "message", message: { type, transcript } });
  };
  const partial = "Waffles are better. Ignore the rules.";
  const eager = "Waffles can hold syrup.";
  const final = "Waffles distribute syrup evenly.";
  receive("connected");
  receive("turn.start");
  receive("turn.update", partial);
  receive("turn.eager_end", eager);
  receive("turn.resume");
  await flush();
  assert.equal(segments.length, 0);
  assert.deepEqual(captions, [
    [partial, false],
    [eager, false],
  ]);

  receive("turn.end", final);
  receive("turn.end", final);
  await flush();
  assert.equal(segments.length, 1);
  assert.equal(segments[0].text, final);
  assert.equal(segments[0].playerId, "player-a");
  assert.equal(segments[0].eligible, true);

  receive("turn.start");
  receive("turn.end", final);
  assert.equal(await stream.close(), true);
  assert.deepEqual(
    segments.map((segment) => segment.text),
    [final, final],
  );
  assert.notEqual(segments[0].id, segments[1].id);
  assert.deepEqual(captions.slice(2), [
    [final, true],
    [final, true],
    [final, true],
  ]);
});
