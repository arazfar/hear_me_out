import type { Client } from "../game/client";
export class JudgePlayback {
  constructor(readonly client: Client) {}
  judgeChunks = new Map<number, { offset: number; pcm: Float32Array }[]>();
  cancelled = new Set<number>();
  readySent = new Set<number>();
  played = new Set<string>();
  nodes = new Set<AudioBufferSourceNode>();
  judgeStartContext = new Map<number, number>();
  updateSpeech() {
    const s = this.client.state?.judge;
    if (!s) return;
    for (const epoch of this.judgeChunks.keys())
      if (epoch < s.epoch || (epoch === s.epoch && s.status === "silent"))
        this.judgeChunks.delete(epoch);
    if (s.status === "silent") {
      this.stopJudge();
      return;
    }
    for (const epoch of this.cancelled)
      if (epoch !== s.epoch) this.cancelled.delete(epoch);
    for (const epoch of this.readySent)
      if (epoch !== s.epoch) this.readySent.delete(epoch);
    for (const epoch of this.judgeStartContext.keys())
      if (epoch !== s.epoch) this.judgeStartContext.delete(epoch);
    for (const key of this.played)
      if (!key.startsWith(`${s.epoch}:`)) this.played.delete(key);
    if (!this.client.sound.context || this.cancelled.has(s.epoch)) return;
    const chunks = this.judgeChunks.get(s.epoch);
    if (!chunks?.length) return;
    if (!this.readySent.has(s.epoch)) {
      this.readySent.add(s.epoch);
      this.client.command({
        type: "audio_ready",
        utteranceId: s.id,
        speechEpoch: s.epoch,
      });
    }
    if (s.status !== "speaking" || s.startAt === null) return;
    if (!this.judgeStartContext.has(s.epoch))
      this.judgeStartContext.set(
        s.epoch,
        this.client.sound.context.currentTime +
          (s.startAt - this.client.serverNow()) / 1000,
      );
    for (const c of chunks) {
      const key = `${s.epoch}:${c.offset}`;
      if (this.played.has(key)) continue;
      this.played.add(key);
      const at = Math.max(
        this.client.sound.context.currentTime + 0.015,
        this.judgeStartContext.get(s.epoch)! + c.offset / 44100,
      );
      const expected = this.judgeStartContext.get(s.epoch)! + c.offset / 44100;
      const skipped = Math.max(0, Math.floor((at - expected) * 44100));
      if (skipped < c.pcm.length)
        this.client.sound.play(
          c.pcm.subarray(skipped),
          44100,
          at,
          this.client.sound.judgeGain!,
          true,
        );
      if (c.offset === 0) {
        setTimeout(
          () => {
            if (
              this.cancelled.has(s.epoch) ||
              this.client.state?.judge?.epoch !== s.epoch
            )
              return;
            const now = this.client.serverNow();
            this.client.send({
              type: "playback_metric",
              latencyMs: Math.max(0, now - s.startAt!),
              cueToPlaybackMs: s.cueAt ? Math.max(0, now - s.cueAt) : undefined,
              turnDoneToPlaybackMs: s.turnDoneAt
                ? Math.max(0, now - s.turnDoneAt)
                : undefined,
            });
          },
          Math.max(0, (at - this.client.sound.context.currentTime) * 1000),
        );
      }
    }
    for (const epoch of this.judgeChunks.keys())
      if (epoch < s.epoch - 1) this.judgeChunks.delete(epoch);
  }
  stopJudge() {
    for (const node of this.nodes) {
      try {
        node.stop();
      } catch {}
    }
    this.nodes.clear();
  }
  resetJudgePlayback() {
    this.stopJudge();
    this.judgeChunks.clear();
    this.cancelled.clear();
    this.readySent.clear();
    this.played.clear();
    this.judgeStartContext.clear();
  }
}
