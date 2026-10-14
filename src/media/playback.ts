import { decodeJudgeAudio, JUDGE_MAX_SAMPLES } from "../../shared/media";
import type { Client } from "../game/client";

type Buffered = {
  seq: number;
  samples: number;
  end: boolean;
  chunks: { offset: number; pcm: Int16Array }[];
  posted: number;
};
export class JudgePlayback {
  constructor(readonly client: Client) {}
  judgeChunks = new Map<number, Buffered>();
  cancelled = new Set<number>();
  readySent = new Set<number>();
  activeEpoch = 0;
  rendering = false;
  finished = false;
  private started = false;
  private firstRender = false;
  private drainTimer: ReturnType<typeof setTimeout> | undefined;
  receive(raw: ArrayBuffer) {
    const packet = decodeJudgeAudio(new Uint8Array(raw)),
      judge = this.client.state?.judge;
    if (
      !packet ||
      this.cancelled.has(packet.epoch) ||
      (judge &&
        (packet.epoch < judge.epoch ||
          packet.epoch > judge.epoch + 4 ||
          (packet.epoch === judge.epoch &&
            ["silent", "captions"].includes(judge.status))))
    )
      return;
    let buffered = this.judgeChunks.get(packet.epoch);
    if (!buffered) {
      if (this.judgeChunks.size >= 2) return;
      buffered = { seq: 0, samples: 0, end: false, chunks: [], posted: 0 };
      this.judgeChunks.set(packet.epoch, buffered);
    }
    if (
      buffered.end ||
      packet.seq !== buffered.seq ||
      packet.offset !== buffered.samples ||
      buffered.samples + packet.pcm.length > JUDGE_MAX_SAMPLES
    ) {
      this.fail(packet.epoch);
      return;
    }
    buffered.seq++;
    buffered.end = packet.end;
    buffered.samples += packet.pcm.length;
    if (!packet.end)
      buffered.chunks.push({ offset: packet.offset, pcm: packet.pcm });
    this.updateSpeech();
  }
  bind(worklet: AudioWorkletNode) {
    worklet.onprocessorerror = () => {
      this.fail(this.activeEpoch);
      worklet.disconnect();
      if (this.client.sound.judgePlayback === worklet)
        this.client.sound.judgePlayback = null;
      void this.client.sound.unlock().catch(() => {});
    };
    worklet.port.onmessage = ({ data }) => {
      const s = this.client.state?.judge;
      if (
        !s ||
        data.epoch !== s.epoch ||
        data.epoch !== this.activeEpoch ||
        this.cancelled.has(s.epoch)
      )
        return;
      if (data.type === "ready") {
        if (
          this.client.sound.context?.state !== "running" ||
          this.readySent.has(s.epoch)
        )
          return;
        this.readySent.add(s.epoch);
        this.client.command({
          type: "audio_ready",
          utteranceId: s.id,
          speechEpoch: s.epoch,
          rttMs: this.client.clock.rttMs,
        });
      } else if (data.type === "failed") this.fail(s.epoch);
      else if (data.type === "drained") {
        this.rendering = false;
        this.ack("progress", data.samples);
        this.drain(s.epoch, data.samples, data.contextTime);
      } else {
        if (data.type === "rendering") {
          this.rendering = true;
          if (!this.firstRender) {
            this.firstRender = true;
            const now =
              this.client.serverNow() +
              (data.contextTime - this.client.sound.context!.currentTime) *
                1000;
            this.client.send({
              type: "playback_metric",
              utteranceId: s.id,
              speechEpoch: s.epoch,
              latencyMs: Math.max(0, now - s.startAt!),
              cueToPlaybackMs: s.cueAt ? Math.max(0, now - s.cueAt) : undefined,
              turnDoneToPlaybackMs: s.turnDoneAt
                ? Math.max(0, now - s.turnDoneAt)
                : undefined,
            });
          }
        } else if (data.type === "buffering") this.rendering = false;
        if (data.type === "progress") this.ack("progress", data.samples);
      }
      this.client.notify({ media: true });
    };
    this.updateSpeech();
  }
  private ack(status: "progress" | "complete" | "failed", samples: number) {
    const s = this.client.state?.judge;
    if (s && s.epoch === this.activeEpoch)
      this.client.command({
        type: "audio_playback",
        utteranceId: s.id,
        speechEpoch: s.epoch,
        status,
        samples,
      });
  }
  private fail(epoch: number) {
    if (this.client.state?.judge?.epoch !== epoch) return;
    this.activeEpoch = epoch;
    this.ack("failed", 0);
    this.cancelled.add(epoch);
    this.stopJudge();
  }
  private drain(epoch: number, samples: number, contextEnd: number) {
    const context = this.client.sound.context!;
    // getOutputTimestamp describes rendered output, not generation or scheduling.
    const guard =
      Math.max(0, context.outputLatency || 0, context.baseLatency || 0) + 0.25;
    const check = () => {
      if (this.activeEpoch !== epoch || this.cancelled.has(epoch)) return;
      const output = context.getOutputTimestamp?.();
      const drained =
        output?.contextTime && output.performanceTime
          ? output.contextTime >= contextEnd
          : context.currentTime >= contextEnd + guard;
      if (context.state === "running" && drained) {
        this.finished = true;
        this.ack("complete", samples);
        this.client.notify({ media: true });
      } else this.drainTimer = setTimeout(check, 20);
    };
    this.drainTimer = setTimeout(check, 20);
  }
  updateSpeech() {
    const s = this.client.state?.judge,
      worklet = this.client.sound.judgePlayback;
    for (const epoch of this.judgeChunks.keys())
      if (!s || epoch < s.epoch) this.judgeChunks.delete(epoch);
    if (!s || ["silent", "captions"].includes(s.status)) {
      this.stopJudge();
      return;
    }
    if (!worklet || this.cancelled.has(s.epoch)) return;
    if (this.activeEpoch !== s.epoch) {
      this.stopJudge();
      this.activeEpoch = s.epoch;
      this.finished = this.firstRender = false;
      for (const epoch of this.cancelled)
        if (epoch < s.epoch) this.cancelled.delete(epoch);
      for (const epoch of this.readySent)
        if (epoch < s.epoch) this.readySent.delete(epoch);
      worklet.port.postMessage({ type: "reset", epoch: s.epoch });
    }
    const buffered = this.judgeChunks.get(s.epoch);
    if (buffered) {
      while (buffered.posted < buffered.chunks.length) {
        const chunk = buffered.chunks[buffered.posted++];
        worklet.port.postMessage({
          type: "pcm",
          epoch: s.epoch,
          offset: chunk.offset,
          pcm: chunk.pcm.buffer,
        });
      }
      if (buffered.end)
        worklet.port.postMessage({
          type: "end",
          epoch: s.epoch,
          samples: buffered.samples,
        });
    }
    if (s.status === "speaking" && s.startAt !== null && !this.started) {
      this.started = true;
      worklet.port.postMessage({
        type: "start",
        epoch: s.epoch,
        at:
          this.client.sound.context!.currentTime +
          Math.max(0, (s.startAt - this.client.serverNow()) / 1000),
      });
    }
  }
  stopJudge() {
    clearTimeout(this.drainTimer);
    this.client.sound.judgePlayback?.port.postMessage({
      type: "reset",
      epoch: 0,
    });
    if (this.activeEpoch) this.judgeChunks.delete(this.activeEpoch);
    this.activeEpoch = 0;
    this.rendering = false;
    this.started = false;
  }
  resetJudgePlayback() {
    this.stopJudge();
    this.judgeChunks.clear();
    this.cancelled.clear();
    this.readySent.clear();
    this.finished = false;
  }
}
