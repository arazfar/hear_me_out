import { decodeVideo, encodeVideo } from "../../shared/media";
import type { Client } from "../game/client";

type VideoPacket = NonNullable<ReturnType<typeof decodeVideo>>;

export class RelayVideo {
  constructor(readonly client: Client) {}
  localFrames = 0;
  localTime = -1;
  lastProbe = 0;
  remoteFrame = false;
  private frameCanvas: HTMLCanvasElement | null = null;
  private displayCanvas: HTMLCanvasElement | null = null;
  remoteFrameAt = 0;
  private pendingVideo: VideoPacket | null = null;
  private decodingGeneration: number | null = null;
  private videoGeneration = 0;
  remoteFrameSeq = 0;
  videoSeq = 0;
  videoInFlight = new Map<number, number>();
  private frameTimer: ReturnType<typeof setInterval> | null = null;
  private cameraVideo: HTMLVideoElement | null = null;
  private frameCallback: number | null = null;
  captureGeneration = 0;
  private pageActive = true;
  private frameReader: FileReader | null = null;
  setPageActive(active: boolean) {
    if (active === this.pageActive) return;
    this.pageActive = active;
    if (!active) this.resetVideo();
  }
  private get canProcessFrames() {
    return this.pageActive && !document.hidden;
  }
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
  private createFrameCanvas() {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 144;
    return canvas;
  }
  private paint(canvas: HTMLCanvasElement, source: CanvasImageSource) {
    try {
      const context = canvas.getContext("2d");
      if (!context) return false;
      context.drawImage(source, 0, 0, 256, 144);
      return true;
    } catch {
      return false;
    }
  }
  /** Decode into the card itself. Keep the latest successful paint across remounts. */
  attachDisplay(canvas: HTMLCanvasElement) {
    this.displayCanvas = canvas;
    if (
      this.remoteFrame &&
      this.frameCanvas &&
      this.paint(canvas, this.frameCanvas)
    )
      this.frameCanvas = canvas;
    return () => {
      if (this.displayCanvas !== canvas) return;
      this.displayCanvas = null;
      if (!this.remoteFrame || this.frameCanvas !== canvas) return;
      const saved = this.createFrameCanvas();
      if (this.paint(saved, canvas)) this.frameCanvas = saved;
    };
  }
  resetVideo() {
    this.cancelFrameRead();
    this.videoGeneration++;
    this.pendingVideo = null;
    this.remoteFrameSeq = 0;
    this.remoteFrameAt = 0;
    this.remoteFrame = false;
    this.videoInFlight.clear();
    this.frameCanvas?.getContext("2d")?.clearRect(0, 0, 256, 144);
  }
  async receive(raw: ArrayBuffer) {
    const frame = decodeVideo(new Uint8Array(raw));
    const state = this.client.state;
    if (!frame || !state || frame.epoch !== state.mediaEpoch) return;
    if (frame.probe) return this.probe(frame);
    if (state.mediaMode === "rtc") return;
    this.pendingVideo = frame;
    return this.decodePending();
  }
  private async decodePending() {
    const generation = this.videoGeneration;
    if (this.decodingGeneration === generation) return;
    this.decodingGeneration = generation;
    try {
      while (generation === this.videoGeneration && this.pendingVideo) {
        const frame = this.pendingVideo;
        this.pendingVideo = null;
        if (!this.canProcessFrames) continue;
        let bitmap: ImageBitmap | null = null;
        try {
          bitmap = await createImageBitmap(
            new Blob([frame.jpeg.slice()], { type: "image/jpeg" }),
          );
          if (
            !this.canProcessFrames ||
            generation !== this.videoGeneration ||
            frame.epoch !== this.client.state?.mediaEpoch ||
            frame.seq <= this.remoteFrameSeq
          )
            continue;
          const target =
            this.displayCanvas || this.frameCanvas || this.createFrameCanvas();
          if (!this.paint(target, bitmap)) continue;
          this.frameCanvas = target;
          const firstFrame = !this.remoteFrame;
          this.remoteFrameSeq = frame.seq;
          this.remoteFrame = true;
          this.remoteFrameAt = Date.now();
          this.client.send({
            type: "video_ack",
            seq: frame.seq,
            mediaEpoch: frame.epoch,
          });
          if (firstFrame) this.client.notify({ media: true });
        } catch {
          /* Keep the last good frame; the next frame can recover. */
        } finally {
          bitmap?.close();
        }
      }
    } finally {
      if (this.decodingGeneration === generation)
        this.decodingGeneration = null;
    }
  }
  private async probe(frame: VideoPacket) {
    const generation = this.videoGeneration;
    try {
      if (frame.generation !== this.captureGeneration) return;
      if (!this.canProcessFrames) return;
      const bitmap = await createImageBitmap(
        new Blob([frame.jpeg.slice()], { type: "image/jpeg" }),
      );
      const valid = bitmap.width > 0 && bitmap.height > 0;
      bitmap.close();
      if (
        valid &&
        this.canProcessFrames &&
        generation === this.videoGeneration &&
        frame.generation === this.captureGeneration
      )
        this.client.send({
          type: "video_ack",
          probe: true,
          seq: frame.seq,
          mediaEpoch: frame.epoch,
        });
    } catch {
      /* A failed decode is not a delivery receipt. */
    }
  }
  private stopCamera() {
    this.cancelFrameRead();
    if (this.frameTimer !== null) clearInterval(this.frameTimer);
    this.frameTimer = null;
    if (this.cameraVideo) {
      if (this.frameCallback !== null)
        this.cameraVideo.cancelVideoFrameCallback?.(this.frameCallback);
      this.cameraVideo.srcObject = null;
      this.cameraVideo = null;
    }
    this.frameCallback = null;
  }
  stop() {
    this.stopCamera();
    this.resetVideo();
    this.frameCanvas = this.displayCanvas = null;
    this.localFrames = 0;
    this.localTime = -1;
    this.lastProbe = 0;
  }
  prepareVideo() {
    if (!this.client.capture.stream) return;
    this.stopCamera();
    const captureGeneration = ++this.captureGeneration;
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
      this.frameCallback = video.requestVideoFrameCallback?.(presented) ?? null;
    };
    this.frameCallback = video.requestVideoFrameCallback?.(presented) ?? null;
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
        !this.canProcessFrames ||
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
        this.canProcessFrames &&
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
