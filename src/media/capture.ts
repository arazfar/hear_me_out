import { encodeMicrophone } from "../../shared/media";
import { canSpeak } from "../../shared/domain";
import type { Client } from "../game/client";
export class DeviceCapture {
  constructor(readonly client: Client) {}
  stream: MediaStream | null = null;
  micLevel = 0;
  micMuted = false;
  cameraOff = false;
  worklet: AudioWorkletNode | null = null;
  source: MediaStreamAudioSourceNode | null = null;
  audioSeq = 0;
  deviceRequest: Promise<void> | null = null;
  devices(camera = true): Promise<void> {
    if (this.deviceRequest) {
      // A user gesture may unblock the existing autoplay-suspended request.
      void this.client.sound.context?.resume().catch(() => {});
      return this.deviceRequest;
    }
    const request = this.acquireDevices(camera);
    this.deviceRequest = request;
    const clear = () => {
      if (this.deviceRequest === request) this.deviceRequest = null;
    };
    void request.then(clear, clear);
    return request;
  }
  private async acquireDevices(camera = true) {
    const generation = this.client.connectionGeneration;
    const current = () => generation === this.client.connectionGeneration;
    await this.client.sound.unlock();
    if (!current()) return;
    if (!navigator.mediaDevices?.getUserMedia)
      throw new Error(
        "Camera and microphone need HTTPS. Open the public tunnel link or localhost.",
      );
    if (this.stream) {
      if (camera && !this.stream.getVideoTracks().length) {
        const video = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 640 },
            height: { ideal: 360 },
            frameRate: { ideal: 24 },
          },
        });
        if (!current() || !this.stream) {
          video.getTracks().forEach((t) => t.stop());
          return;
        }
        this.stream.addTrack(video.getVideoTracks()[0]);
        this.cameraOff = false;
        this.syncMicrophone();
        this.client.video.prepareVideo();
        this.client.peer.pc?.addTrack(video.getVideoTracks()[0], this.stream);
      }
      this.client.notify({ media: true });
      return;
    }
    let acquired: MediaStream;
    try {
      acquired = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: camera
          ? {
              width: { ideal: 640 },
              height: { ideal: 360 },
              frameRate: { ideal: 24 },
            }
          : false,
      });
    } catch (e) {
      if (camera) {
        if (!current()) return;
        acquired = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
          video: false,
        });
        this.cameraOff = true;
      } else throw e;
    }
    if (!current()) {
      acquired.getTracks().forEach((t) => t.stop());
      return;
    }
    this.stream = acquired;
    await this.client.sound.context!.audioWorklet.addModule("/pcm-worklet.js");
    if (!current()) {
      acquired.getTracks().forEach((t) => t.stop());
      return;
    }
    this.source = this.client.sound.context!.createMediaStreamSource(
      new MediaStream(this.stream.getAudioTracks()),
    );
    this.worklet = new AudioWorkletNode(
      this.client.sound.context!,
      "pcm-capture",
    );
    const silence = this.client.sound.context!.createGain();
    silence.gain.value = 0;
    this.source
      .connect(this.worklet)
      .connect(silence)
      .connect(this.client.sound.context!.destination);
    let levelAt = 0;
    this.worklet.port.onmessage = ({ data }) => {
      const allowed = this.microphoneAllowed();
      this.micLevel = allowed ? data.level : 0;
      if (Date.now() - levelAt > 100) {
        levelAt = Date.now();
        if (this.client.session)
          this.client.notify({
            activity: {
              playerId: this.client.session.playerId,
              level: Math.min(1, this.micLevel * 8),
            },
          });
        else this.client.notify({ media: true });
      }
      const audio = this.client.sockets.get("audio");
      if (
        !this.client.clock.synced ||
        !audio ||
        audio.readyState !== WebSocket.OPEN ||
        audio.bufferedAmount > 8000
      )
        return;
      const pcm = allowed
        ? new Uint8Array(data.pcm)
        : new Uint8Array(data.pcm.byteLength);
      const packet = encodeMicrophone(
        this.client.state?.mediaEpoch || 0,
        ++this.audioSeq,
        this.client.serverNow(),
        pcm,
      );
      audio.send(packet);
    };
    this.syncMicrophone();
    this.client.video.prepareVideo();
    if (this.client.state) {
      this.client.peer.makePeer();
      for (const data of this.client.peer.pendingSignals.splice(0))
        await this.client.peer.signal(data);
    }
    this.client.notify({ media: true });
  }
  microphoneAllowed() {
    return (
      (!this.client.session ||
        (!this.client.disconnecting &&
          !this.client.reconnecting &&
          !this.client.reconnectTimer)) &&
      !this.micMuted &&
      canSpeak(this.client.state, this.client.session?.playerId || null)
    );
  }
  syncMicrophone() {
    this.stream?.getAudioTracks().forEach((t) => {
      t.enabled = this.microphoneAllowed();
    });
  }
  muteMic() {
    this.micMuted = !this.micMuted;
    this.syncMicrophone();
    this.client.notify({ media: true });
  }
  muteCamera() {
    if (!this.stream?.getVideoTracks().length) {
      void this.devices(true).catch(() =>
        this.client.notify({
          error:
            "Allow camera in Chrome’s site controls, then try Camera again.",
        }),
      );
      return;
    }
    this.cameraOff = !this.cameraOff;
    this.stream?.getVideoTracks().forEach((t) => (t.enabled = !this.cameraOff));
    this.client.notify({ media: true });
  }
}
