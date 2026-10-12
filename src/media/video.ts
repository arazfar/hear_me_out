import { encodeVideo } from "../../shared/media";
import type { Client } from "../game/client";
export class RelayVideo {
  constructor(readonly client: Client) {}
  remoteFrame = false;
  remoteCanvas: HTMLCanvasElement | null = null;
  remoteFrameAt = 0;
  pendingVideo: ArrayBuffer | null = null;
  decodingVideo = false;
  videoGeneration = 0;
  remoteFrameSeq = 0;
  videoSeq = 0;
  videoInFlight = new Map<number, number>();
  frameTimer: ReturnType<typeof setInterval> | null = null;
  cameraVideo: HTMLVideoElement | null = null;
  resetVideo() {
    this.videoGeneration++;
    this.pendingVideo = null;
    this.remoteFrameSeq = 0;
    this.remoteFrameAt = 0;
    this.remoteFrame = false;
    this.videoInFlight.clear();
    this.remoteCanvas?.getContext("2d")?.clearRect(0, 0, 256, 144);
  }
  async decodeVideo() {
    if (this.decodingVideo) return;
    this.decodingVideo = true;
    try {
      while (this.pendingVideo) {
        const frame = this.pendingVideo;
        this.pendingVideo = null;
        const generation = this.videoGeneration;
        const header = new DataView(frame);
        let bitmap: ImageBitmap | null = null;
        try {
          bitmap = await createImageBitmap(
            new Blob([frame.slice(17)], { type: "image/jpeg" }),
          );
          const seq = header.getUint32(5, true);
          if (
            generation !== this.videoGeneration ||
            header.getUint32(1, true) !== this.client.state?.mediaEpoch ||
            seq <= this.remoteFrameSeq
          )
            continue;
          this.remoteCanvas ||= document.createElement("canvas");
          if (this.remoteCanvas.width !== 256) this.remoteCanvas.width = 256;
          if (this.remoteCanvas.height !== 144) this.remoteCanvas.height = 144;
          this.remoteCanvas.getContext("2d")!.drawImage(bitmap, 0, 0, 256, 144);
          this.remoteFrameSeq = seq;
          this.remoteFrame = true;
          this.remoteFrameAt = Date.now();
          this.client.notify({ media: true });
        } catch {
          /* Keep the last good frame; the next frame can recover. */
        } finally {
          bitmap?.close();
        }
      }
    } finally {
      this.decodingVideo = false;
    }
  }
  prepareVideo() {
    if (!this.client.capture.stream) return;
    this.cameraVideo = document.createElement("video");
    this.cameraVideo.muted = true;
    this.cameraVideo.playsInline = true;
    this.cameraVideo.srcObject = this.client.capture.stream;
    void this.cameraVideo.play().catch(() => {});
    if (this.frameTimer) clearInterval(this.frameTimer);
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 144;
    const ctx = canvas.getContext("2d")!;
    let encoding = false;
    this.frameTimer = setInterval(() => {
      const ws = this.client.sockets.get("video");
      if (
        !this.client.state ||
        this.client.state.mediaMode === "rtc" ||
        this.client.capture.cameraOff ||
        encoding ||
        !ws ||
        ws.readyState !== WebSocket.OPEN ||
        ws.bufferedAmount > 12000 ||
        !this.cameraVideo ||
        this.cameraVideo.readyState < 2
      )
        return;
      for (const [seq, at] of this.videoInFlight)
        if (Date.now() - at > 750) this.videoInFlight.delete(seq);
      if (this.videoInFlight.size >= 2) return;
      encoding = true;
      const capturedAt = this.client.serverNow();
      const mediaEpoch = this.client.state.mediaEpoch;
      ctx.drawImage(this.cameraVideo, 0, 0, 256, 144);
      canvas.toBlob(
        async (blob) => {
          try {
            if (!blob || this.client.state?.mediaEpoch !== mediaEpoch) return;
            const data = await blob.arrayBuffer();
            const packet = encodeVideo(
              mediaEpoch,
              ++this.videoSeq,
              capturedAt,
              new Uint8Array(data),
            );
            if (ws.readyState === WebSocket.OPEN && ws.bufferedAmount < 12000) {
              this.videoInFlight.set(this.videoSeq, Date.now());
              ws.send(packet);
            }
          } finally {
            encoding = false;
          }
        },
        "image/jpeg",
        0.35,
      );
    }, 1000 / 15);
  }
}
