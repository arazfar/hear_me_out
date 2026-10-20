import { encodeMicrophone, type CapturePurpose } from "../../shared/media";
import { canConverse, canSendJudgeInput } from "../../shared/domain";
import type { Client } from "../game/client";
import { loadWorklet } from "./worklet";

export function deviceError(error: unknown, repair?: "camera"): Error {
  const name = error instanceof Error ? error.name : "";
  if (repair === "camera") {
    if (name === "NotFoundError")
      return new Error("Connect your camera, then try again.");
    if (name === "NotAllowedError")
      return new Error(
        "Allow your camera in your browser’s site settings, then retry.",
      );
    if (name === "NotReadableError")
      return new Error(
        "Your camera is busy. Close other apps using it, then retry.",
      );
  }
  if (name === "NotFoundError")
    return new Error("Connect a microphone and camera, then try again.");
  if (name === "NotAllowedError")
    return new Error(
      "Allow your mic and camera in your browser’s site settings, then retry.",
    );
  if (name === "NotReadableError")
    return new Error(
      "Your mic or camera is busy. Close other apps using it, then retry.",
    );
  return error instanceof Error
    ? error
    : new Error("Couldn’t connect your devices. Try again.");
}
type Acquisition = {
  controller: AbortController;
  tracks: Set<MediaStreamTrack>;
  nodes: Set<AudioNode>;
  promise: Promise<void>;
};

export class DeviceCapture {
  constructor(readonly client: Client) {}
  stream: MediaStream | null = null;
  micLevel = 0;
  captureFailed = false;
  micMuted = false;
  cameraOff = false;
  worklet: AudioWorkletNode | null = null;
  source: MediaStreamAudioSourceNode | null = null;
  audioSeq = 0;
  pendingDone: string | null = null;
  doneAt = 0;
  private closedEpoch = -1;
  private gateKey = "";
  private clockSyncedAt = 0;
  private isolation = new Map<
    string,
    { complete: () => void; cancel: () => void }
  >();
  private acquisition: Acquisition | null = null;
  private silence: GainNode | null = null;
  private cleanup: (() => void)[] = [];
  micDevice = "";
  cameraDevice = "";
  get deviceRequest() {
    return this.acquisition?.promise ?? null;
  }
  get captureId() {
    return this.stream?.getAudioTracks()[0]?.id || "";
  }
  cancelRequest() {
    this.acquisition?.controller.abort(new Error("Setup cancelled."));
  }
  stop() {
    this.cancelRequest();
    for (const pending of this.isolation.values()) pending.cancel();
    this.isolation.clear();
    this.pendingDone = null;
    this.closedEpoch = -1;
    this.gateKey = "";
    this.clockSyncedAt = 0;
    this.cleanup.splice(0).forEach((fn) => fn());
    this.cleanup = [];
    this.worklet?.disconnect();
    this.source?.disconnect();
    this.silence?.disconnect();
    this.worklet = null;
    this.source = null;
    this.silence = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
  }
  devices(repair?: "camera", signal?: AbortSignal): Promise<void> {
    if (this.acquisition) {
      void this.client.sound.context?.resume().catch(() => {});
      return this.acquisition.promise;
    }
    const attempt: Acquisition = {
      controller: new AbortController(),
      tracks: new Set(),
      nodes: new Set(),
      promise: Promise.resolve(),
    };
    this.acquisition = attempt;
    attempt.promise = new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        signal?.removeEventListener("abort", cancel);
        attempt.controller.signal.removeEventListener("abort", aborted);
        attempt.nodes.forEach((node) => node.disconnect());
        attempt.tracks.forEach((track) => track.stop());
        attempt.nodes.clear();
        attempt.tracks.clear();
        if (this.acquisition === attempt) this.acquisition = null;
        error ? reject(deviceError(error, repair)) : resolve();
      };
      const cancel = () =>
        attempt.controller.abort(new Error("Setup cancelled."));
      const aborted = () => finish(attempt.controller.signal.reason);
      const deadline = setTimeout(
        () =>
          attempt.controller.abort(
            new Error(
              "Device setup took too long. Check permissions and try again.",
            ),
          ),
        30000,
      );
      attempt.controller.signal.addEventListener("abort", aborted, {
        once: true,
      });
      signal?.addEventListener("abort", cancel, { once: true });
      if (signal?.aborted) cancel();
      else void this.acquire(attempt, repair).then(() => finish(), finish);
    });
    return attempt.promise;
  }
  private async acquire(attempt: Acquisition, repair?: "camera") {
    const current = () =>
      this.acquisition === attempt && !attempt.controller.signal.aborted;
    const check = () => {
      if (!current()) throw new Error("Setup cancelled.");
    };
    check();
    await this.client.sound.unlock();
    check();
    if (!navigator.mediaDevices?.getUserMedia)
      throw new Error("Open the game over HTTPS to use your mic and camera.");
    const previous = this.stream;
    let audio = previous?.getAudioTracks()[0],
      video = previous?.getVideoTracks()[0];
    const needsAudio =
      !audio ||
      audio.readyState !== "live" ||
      audio.muted ||
      (this.micDevice && audio.getSettings().deviceId !== this.micDevice);
    const needsVideo =
      repair === "camera" ||
      !video ||
      video.readyState !== "live" ||
      (this.cameraDevice && video.getSettings().deviceId !== this.cameraDevice);
    if (needsAudio || needsVideo) {
      const acquired = await navigator.mediaDevices.getUserMedia({
        audio: needsAudio
          ? {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
              ...(this.micDevice
                ? { deviceId: { exact: this.micDevice } }
                : {}),
            }
          : false,
        video: needsVideo
          ? {
              width: { ideal: 640 },
              height: { ideal: 360 },
              frameRate: { ideal: 24 },
              facingMode: "user",
              ...(this.cameraDevice
                ? { deviceId: { exact: this.cameraDevice } }
                : {}),
            }
          : false,
      });
      // Permission requests cannot be aborted. An obsolete response owns only
      // these returned tracks, never a track borrowed from the current stream.
      if (!current()) {
        acquired.getTracks().forEach((track) => track.stop());
        check();
      }
      acquired.getTracks().forEach((track) => {
        track.enabled =
          track.kind === "audio" ? !this.micMuted : !this.cameraOff;
        attempt.tracks.add(track);
      });
      if (needsAudio) audio = acquired.getAudioTracks()[0];
      if (needsVideo) video = acquired.getVideoTracks()[0];
    }
    if (
      !audio ||
      !video ||
      audio.readyState !== "live" ||
      video.readyState !== "live"
    )
      throw new Error("Both a mic and camera are needed to play.");
    const stream =
      needsAudio || needsVideo ? new MediaStream([audio, video]) : previous!;
    const context = this.client.sound.context!;
    let graph:
      | {
          source: MediaStreamAudioSourceNode;
          worklet: AudioWorkletNode;
          silence: GainNode;
        }
      | undefined;
    if (needsAudio || !this.worklet || this.captureFailed) {
      try {
        await loadWorklet(
          context,
          "/pcm-worklet.js",
          attempt.controller.signal,
        );
      } catch {
        throw new Error("Couldn’t load microphone audio. Try again.");
      }
      check();
      const source = context.createMediaStreamSource(new MediaStream([audio]));
      attempt.nodes.add(source);
      const worklet = new AudioWorkletNode(context, "pcm-capture");
      attempt.nodes.add(worklet);
      const silence = context.createGain();
      attempt.nodes.add(silence);
      silence.gain.value = 0;
      source.connect(worklet).connect(silence).connect(context.destination);
      graph = { source, worklet, silence };
    }
    check();
    if (audio.readyState !== "live" || video.readyState !== "live")
      throw new Error("Your mic or camera stopped. Reconnect it and retry.");
    // Commit synchronously after local initialization. Until this point the
    // current stream and graph still belong to the player, not the attempt.
    if (graph) {
      this.source?.disconnect();
      this.worklet?.disconnect();
      this.silence?.disconnect();
      this.source = graph.source;
      this.worklet = graph.worklet;
      this.silence = graph.silence;
      this.captureFailed = false;
      this.gateKey = "";
      this.listenToAudio(graph.worklet);
      attempt.nodes.clear();
    }
    // Privacy belongs to the player, including choices made while permission
    // or worklet initialization was pending. Publish already-gated tracks.
    audio.enabled = !this.micMuted;
    video.enabled = !this.cameraOff;
    this.stream = stream;
    for (const track of stream.getTracks()) attempt.tracks.delete(track);
    previous
      ?.getTracks()
      .filter((track) => !stream.getTracks().includes(track))
      .forEach((track) => track.stop());
    if (previous !== stream) this.client.peer.reset();
    this.listenToDevices(stream, context);
    this.syncMicrophone();
    this.client.video.prepareVideo();
    this.client.peer.makePeer();
    this.client.notify({ media: true });
    void this.client.reportHealth();
  }
  private listenToAudio(worklet: AudioWorkletNode) {
    worklet.onprocessorerror = () => {
      if (worklet !== this.worklet) return;
      this.captureFailed = true;
      this.client.notify({ media: true });
      void this.client.reportHealth();
    };
    let levelAt = 0;
    worklet.port.onmessage = ({ data }) => {
      if (worklet !== this.worklet) return;
      if (data.type === "isolated") {
        this.isolation.get(data.requestId)?.complete();
        return;
      }
      const context = this.client.sound.context;
      if (
        context?.state === "running" &&
        performance.now() - this.clockSyncedAt >= 250
      ) {
        this.clockSyncedAt = performance.now();
        worklet.port.postMessage({
          type: "clock",
          serverAt: this.client.serverNow(),
          contextAt: context.currentTime,
        });
      }
      const allowed = !this.micMuted;
      this.micLevel = allowed ? data.level || 0 : 0;
      if (Date.now() - levelAt > 100 && data.type !== "end") {
        levelAt = Date.now();
        this.client.notify(
          this.client.session
            ? {
                activity: {
                  playerId: this.client.session.playerId,
                  level: Math.min(1, this.micLevel * 8),
                },
              }
            : { media: true },
        );
      }
      const socket = this.client.sockets.get("audio");
      if (!this.client.clock.synced || socket?.readyState !== WebSocket.OPEN)
        return;
      const gameplay = data.purpose === "gameplay",
        privateAudio = data.purpose === "private";
      if (socket.bufferedAmount > 64000) {
        // Never silently lose eligible evidence. A broken uplink must enter bounded recovery.
        if (gameplay || privateAudio || data.type === "end") socket.close();
        return;
      }
      if (data.type === "end") {
        socket.send(
          encodeMicrophone(
            data.mediaEpoch,
            ++this.audioSeq,
            data.capturedAt,
            new Uint8Array(),
            { purpose: "gameplay", inputEpoch: data.inputEpoch, end: true },
          ),
        );
        if (data.done && this.pendingDone)
          this.client.command({
            type: "done",
            turnId: this.pendingDone,
            lastAudioSeq: this.audioSeq,
          });
        return;
      }
      const health =
        data.purpose === "health" ||
        (!gameplay && !privateAudio && this.client.state?.mediaMode === "rtc");
      socket.send(
        encodeMicrophone(
          data.mediaEpoch,
          ++this.audioSeq,
          data.capturedAt,
          health
            ? new Uint8Array()
            : allowed
              ? new Uint8Array(data.pcm)
              : new Uint8Array(data.pcm.byteLength),
          {
            purpose: health ? "health" : data.purpose,
            inputEpoch: health ? 0 : data.inputEpoch,
          },
        ),
      );
    };
  }
  private listenToDevices(stream: MediaStream, context: AudioContext) {
    this.cleanup.splice(0).forEach((fn) => fn());
    const cleanup = (this.cleanup = [] as (() => void)[]);
    const changed = () => {
      this.client.notify({ media: true });
      void this.client.reportHealth();
    };
    for (const track of stream.getTracks())
      for (const event of ["ended", "mute", "unmute"]) {
        track.addEventListener(event, changed);
        cleanup.push(() => track.removeEventListener(event, changed));
      }
    navigator.mediaDevices.addEventListener("devicechange", changed);
    cleanup.push(() =>
      navigator.mediaDevices.removeEventListener("devicechange", changed),
    );
    context.addEventListener("statechange", changed);
    cleanup.push(() => context.removeEventListener("statechange", changed));
    for (const name of ["microphone", "camera"] as PermissionName[]) {
      void navigator.permissions
        ?.query({ name })
        .then((permission) => {
          if (this.cleanup !== cleanup || this.stream !== stream) return;
          const check = () => {
            if (permission.state === "denied")
              stream
                .getTracks()
                .filter(
                  (track) =>
                    track.kind === (name === "microphone" ? "audio" : "video"),
                )
                .forEach((track) => track.stop());
            changed();
          };
          permission.addEventListener("change", check);
          cleanup.push(() => permission.removeEventListener("change", check));
        })
        .catch(() => {});
    }
  }
  privateCheck() {
    const setup = this.client.setup;
    return (
      setup.inline ||
      setup.listening ||
      setup.phase === "testing" ||
      (setup.busy && setup.repair !== "camera")
    );
  }
  microphoneAllowed() {
    return (
      canConverse(this.privateCheck(), this.micMuted) &&
      !this.client.reconnecting
    );
  }
  private policy(): { purpose: CapturePurpose; inputEpoch: number } {
    if (this.micMuted || this.client.reconnecting)
      return { purpose: "health", inputEpoch: 0 };
    if (this.client.setup.listening)
      return { purpose: "private", inputEpoch: this.client.setup.inputEpoch };
    if (this.privateCheck()) return { purpose: "health", inputEpoch: 0 };
    const state = this.client.state;
    if (
      canSendJudgeInput(state, this.client.session?.playerId || null) &&
      state?.turn?.inputEpoch !== this.closedEpoch
    )
      return { purpose: "gameplay", inputEpoch: state!.turn!.inputEpoch! };
    return { purpose: "social", inputEpoch: 0 };
  }
  syncMicrophone(requestId?: string) {
    this.stream?.getAudioTracks().forEach((t) => (t.enabled = !this.micMuted));
    void this.client.peer.syncAudio();
    this.client.sound.syncPeerPrivacy();
    if (
      this.pendingDone &&
      (this.client.state?.turn?.id !== this.pendingDone ||
        this.client.state?.turn?.inputEpoch !== this.closedEpoch)
    )
      this.pendingDone = null;
    const policy = this.policy();
    const message = {
      type: "gate",
      ...policy,
      mediaEpoch: this.client.state?.mediaEpoch || 0,
      endsAt:
        policy.purpose === "gameplay"
          ? this.client.state?.turn?.deadline
          : null,
    };
    const key = JSON.stringify(message);
    if (key !== this.gateKey || requestId) {
      this.gateKey = key;
      this.clockSyncedAt = performance.now();
      this.worklet?.port.postMessage({
        ...message,
        requestId,
        serverAt: this.client.serverNow(),
        contextAt: this.client.sound.context?.currentTime || 0,
      });
    }
  }
  async isolate() {
    const id = crypto.randomUUID();
    const capture = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.isolation.delete(id);
        reject(new Error("Couldn’t isolate your mic. Try again."));
      }, 2000);
      this.isolation.set(id, {
        complete: () => {
          clearTimeout(timer);
          this.isolation.delete(id);
          resolve();
        },
        cancel: () => {
          clearTimeout(timer);
          reject(new Error("Setup cancelled."));
        },
      });
    });
    this.syncMicrophone(id);
    await Promise.all([capture, this.client.peer.syncAudio()]);
  }
  finishTurn() {
    const turn = this.client.state?.turn;
    if (
      !turn ||
      this.pendingDone ||
      !canSendJudgeInput(
        this.client.state,
        this.client.session?.playerId || null,
      )
    )
      return;
    this.pendingDone = turn.id;
    this.doneAt = this.client.serverNow();
    this.closedEpoch = turn.inputEpoch!;
    this.worklet?.port.postMessage({
      type: "done",
      inputEpoch: turn.inputEpoch,
      nextPurpose: "social",
    });
    this.client.notify({ media: true });
  }
  muteMic() {
    this.micMuted = !this.micMuted;
    this.acquisition?.tracks.forEach((track) => {
      if (track.kind === "audio") track.enabled = !this.micMuted;
    });
    this.syncMicrophone();
    this.client.setup.privacyChanged();
    this.client.notify({ media: true });
    void this.client.reportHealth();
  }
  muteCamera() {
    this.cameraOff = !this.cameraOff;
    this.acquisition?.tracks.forEach((track) => {
      if (track.kind === "video") track.enabled = !this.cameraOff;
    });
    this.stream?.getVideoTracks().forEach((t) => (t.enabled = !this.cameraOff));
    this.client.setup.privacyChanged();
    this.client.notify({ media: true });
    void this.client.reportHealth();
  }
}
