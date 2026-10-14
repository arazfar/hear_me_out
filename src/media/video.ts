import { encodeVideo } from "../../shared/media";
import type { Client } from "../game/client";
export class RelayVideo {
  constructor(readonly client: Client) {}
  localFrames = 0;
  localTime = -1;
  lastProbe = 0;
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
  captureGeneration = 0;
  private frameReader: FileReader | null = null;
  cancelFrameRead() {
    this.frameReader?.abort();
  }
  private readFrame(blob: Blob) {
    // Unlike Blob.arrayBuffer(), this read can be stopped before a document
    // loses access to its local Blob during navigation (notably in WebKit).
    return new Promise<ArrayBuffer | null>((resolve) => {
      const reader = new FileReader();
      this.frameReader = reader;
      const finish = (data: ArrayBuffer | null) => {
        reader.onload = reader.onerror = reader.onabort = null;
        if (this.frameReader === reader) this.frameReader = null;
        resolve(data);
      };
      reader.onload = () =>
        finish(reader.result instanceof ArrayBuffer ? reader.result : null);
      reader.onerror = reader.onabort = () => finish(null);
      try {
        reader.readAsArrayBuffer(blob);
      } catch {
        finish(null);
      }
    });
  }
  resetVideo() {
    this.cancelFrameRead();
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
            new Blob([frame.slice(21)], { type: "image/jpeg" }),
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
          this.client.send({
            type: "video_ack",
            seq,
            mediaEpoch: header.getUint32(1, true),
          });
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
  async probe(frame: ArrayBuffer) {
    const generation = this.videoGeneration;
    try {
      if (new DataView(frame).getUint32(17, true) !== this.captureGeneration)
        return;
      const bitmap = await createImageBitmap(
        new Blob([frame.slice(21)], { type: "image/jpeg" }),
      );
      const valid = bitmap.width > 0 && bitmap.height > 0;
      bitmap.close();
      if (valid && generation === this.videoGeneration)
        this.client.send({
          type: "video_ack",
          probe: true,
          seq: new DataView(frame).getUint32(5, true),
          mediaEpoch: new DataView(frame).getUint32(1, true),
        });
    } catch {
      /* A failed decode is not a delivery receipt. */
    }
  }
  prepareVideo() {
    if (!this.client.capture.stream) return;
    this.cancelFrameRead();
    const captureGeneration = ++this.captureGeneration;
    if (this.cameraVideo) this.cameraVideo.srcObject = null;
    this.localTime = -1;
    this.cameraVideo = document.createElement("video");
    this.cameraVideo.muted = true;
    this.cameraVideo.playsInline = true;
    this.cameraVideo.srcObject = this.client.capture.stream;
    void this.cameraVideo.play().catch(() => {});
    const video = this.cameraVideo;
    const progress = (frames: number) => {
      const previous = Math.max(0, this.localTime);
      if (frames <= previous) return;
      this.localFrames += frames - previous;
      this.localTime = frames;
    };
    const presented: VideoFrameRequestCallback = (_now, metadata) => {
      if (video !== this.cameraVideo) return;
      // A delayed presentation callback and the decoder poll can describe the
      // same cached frame. Count it once, including after preview recreation.
      progress(
        Math.max(
          metadata.presentedFrames,
          video.getVideoPlaybackQuality?.().totalVideoFrames || 0,
        ),
      );
      video.requestVideoFrameCallback?.(presented);
    };
    video.requestVideoFrameCallback?.(presented);
    if (this.frameTimer) clearInterval(this.frameTimer);
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 144;
    const ctx = canvas.getContext("2d")!;
    let encoding = false;
    this.frameTimer = setInterval(() => {
      const ws = this.client.sockets.get("video");
      // Decoder counts keep capture health accurate when a preview is offscreen.
      const decoded = video.getVideoPlaybackQuality?.().totalVideoFrames;
      if (decoded !== undefined) {
        progress(decoded);
      } else if (
        !video.requestVideoFrameCallback &&
        decoded === undefined &&
        video.readyState >= 2 &&
        video.currentTime !== this.localTime
      ) {
        this.localTime = video.currentTime;
        this.localFrames++;
      }
      const probe = Date.now() - this.lastProbe >= 750;
      if (
        !this.client.state ||
        (this.client.state.mediaMode === "rtc" && !probe) ||
        this.client.capture.cameraOff ||
        document.hidden ||
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
      const generation = this.videoGeneration;
      const current = () =>
        !document.hidden &&
        this.client.state?.mediaEpoch === mediaEpoch &&
        generation === this.videoGeneration &&
        captureGeneration === this.captureGeneration;
      ctx.drawImage(this.cameraVideo, 0, 0, 256, 144);
      canvas.toBlob(
        async (blob) => {
          try {
            if (!blob || !current()) return;
            const data = await this.readFrame(blob);
            if (!data || !current()) return;
            const packet = encodeVideo(
              mediaEpoch,
              ++this.videoSeq,
              capturedAt,
              new Uint8Array(data),
              probe,
              captureGeneration,
            );
            if (ws.readyState === WebSocket.OPEN && ws.bufferedAmount < 12000) {
              if (probe) this.lastProbe = Date.now();
              this.videoInFlight.set(this.videoSeq, Date.now());
              ws.send(packet);
            }
          } catch {
            // Navigation or source replacement can invalidate a pending Blob.
            // Drop this frame; sustained failure still expires delivery health.
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
