import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

test("relay playback limits late bursts, resamples in the audio thread, and flushes on mode changes", () => {
  let Processor: any;
  runInNewContext(readFileSync("public/peer-worklet.js", "utf8"), {
    AudioWorkletProcessor: class {
      port: any = {};
    },
    Float32Array,
    sampleRate: 48000,
    registerProcessor: (_name: string, value: any) => {
      Processor = value;
    },
  });
  const p = new Processor();
  const push = (n: number, value: number) =>
    p.port.onmessage({ data: { pcm: new Float32Array(n).fill(value).buffer } });
  const output = new Float32Array(128);
  push(320, 0.2);
  p.process([], [[output]]);
  assert(
    output.every((x) => x === 0),
    "prebuffer must prevent a one-packet underrun",
  );
  push(320, 0.2);
  p.process([], [[output]]);
  assert(output.every((x) => Math.abs(x - 0.2) < 0.001));
  assert(
    p.count < 640 && p.count > 590,
    "16 kHz audio must resample to 48 kHz",
  );
  push(3200, 0.8);
  assert.equal(p.count, 640, "late burst keeps only 40 ms of fresh audio");
  p.process([], [[output]]);
  assert(output.every((x) => Math.abs(x - 0.8) < 0.001));
  p.port.onmessage({ data: { type: "flush" } });
  assert.equal(p.count, 0);
  assert.equal(p.started, false);
});
