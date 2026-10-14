import { decodeMicrophone, decodeVideo } from "../../shared/media";
import {
  PROTOCOL_VERSION,
  serverMessageSchema,
  type Session,
} from "../../shared/protocol";
import { type Snapshot } from "../../shared/domain";
import { type Command, type GameEvent } from "../../shared/protocol";
import { Connection } from "./connection";
import { DeviceSetup } from "./setup";
import { DeviceCapture } from "../media/capture";
import { PeerMedia } from "../media/peer";
import { JudgePlayback } from "../media/playback";
import { ServerClock } from "../media/server-clock";
import { AudioOutput } from "../media/sound";
import { RelayVideo } from "../media/video";
import { FeedbackController, type FeedbackCue } from "./feedback";
export type Update = {
  state?: Snapshot;
  event?: GameEvent;
  error?: string;
  connection?: string;
  activity?: { playerId: string; level: number };
  media?: true;
  feedback?: FeedbackCue;
  feedbackReset?: boolean;
};
export class Client {
  feedback = new FeedbackController();
  connection = new Connection(this);
  setup = new DeviceSetup(this);
  capture = new DeviceCapture(this);
  sound = new AudioOutput(this);
  peer = new PeerMedia(this);
  video = new RelayVideo(this);
  playback = new JudgePlayback(this);
  session: Session | null = null;
  state: Snapshot | null = null;
  sockets = new Map<string, WebSocket>();
  clock = new ServerClock();
  get offset() {
    return this.clock.synced ? this.serverNow() - Date.now() : 0;
  }
  serverNow() {
    return this.clock.synced ? this.clock.now() : Date.now();
  }
  private entryRequest: AbortController | null = null;
  pingTimer: ReturnType<typeof setInterval> | null = null;
  statusTimer: ReturnType<typeof setInterval> | null = null;
  get reconnecting() {
    return this.connection.blocked;
  }
  private judgeRetry: ReturnType<typeof setTimeout> | undefined;
  closeTransport() {
    clearTimeout(this.judgeRetry);
    const sockets = [...this.sockets.values()];
    this.sockets.clear();
    for (const socket of sockets) socket.close();
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.statusTimer) clearInterval(this.statusTimer);
    this.pingTimer = this.statusTimer = null;
  }
  invalidateConnection() {
    this.entryRequest?.abort();
    this.entryRequest = null;
    this.connection.cancel();
    this.closeTransport();
  }
  listeners = new Set<(u: Update) => void>();
  on(update: (u: Update) => void) {
    this.listeners.add(update);
    return () => {
      this.listeners.delete(update);
    };
  }
  notify(u: Update) {
    if (u.state) {
      const result = this.feedback.accept(u.state, u.event);
      u = {
        ...u,
        feedback: result.cue,
        feedbackReset: result.reset || u.feedbackReset,
      };
    }
    if (u.connection === "left" || u.connection === "reconnecting")
      u.feedbackReset = true;
    if (typeof document !== "undefined" && document.hidden)
      u.feedback = undefined;
    if (u.activity && u.activity.level > 0.02) this.sound.duckForSpeech();
    if (u.state) this.sound.updateEffectsGain();
    if (u.feedbackReset) this.sound.stopEffects();
    for (const f of this.listeners) f(u);
  }
  async enter(kind: "create" | "join", name: string, code?: string) {
    if (this.session) this.leave();
    this.capture.micMuted = this.capture.cameraOff = false;
    this.setup.inline = true;
    this.setup.phase = "connecting";
    this.notify({ media: true });
    this.invalidateConnection();
    const request = (this.entryRequest = new AbortController());
    const current = () =>
      this.entryRequest === request && !request.signal.aborted;
    // Start from the tap, but let seat cancellation complete even if an audio
    // module is slow. DeviceSetup owns awaiting and reporting this same attempt.
    void this.sound.unlock().catch(() => {});
    if (!current()) return;
    const reservation = fetch(kind === "create" ? "/api/rooms" : "/api/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, code }),
    }).then(async (response) => {
      const body = await response.json();
      if (!current() && body.session) this.releaseSeat(body.session);
      return { response, body };
    });
    let cancel = () => {};
    const cancelled = new Promise<never>((_, reject) => {
      cancel = () => reject(new Error("Couldn’t connect to court. Try again."));
      request.signal.addEventListener("abort", cancel, { once: true });
    });
    const timer = setTimeout(() => request.abort(), 10000);
    try {
      const { response, body } = await Promise.race([reservation, cancelled]);
      if (!current()) return;
      if (!response.ok) throw new Error(body.error);
      clearTimeout(timer);
      if (await this.connection.open(body.session, body.snapshot))
        await this.setup.run();
    } catch (error) {
      if (this.entryRequest === request) {
        this.setup.inline = false;
        this.setup.phase = "idle";
        throw error;
      }
    } finally {
      clearTimeout(timer);
      request.signal.removeEventListener("abort", cancel);
      if (this.entryRequest === request) this.entryRequest = null;
    }
  }
  releaseSeat(session: Session & { resumeId?: string }) {
    void fetch("/api/leave", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(session),
      keepalive: true,
    }).catch(() => {});
  }

  attach(session: Session, snapshot: Snapshot) {
    this.clock.reset();
    this.closeTransport();
    this.peer.reset();
    this.video.resetVideo();
    this.session = session;
    this.state = snapshot;
    this.capture.syncMicrophone();
    this.capture.audioSeq = 0;
    this.notify({ state: snapshot });
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    for (const channel of ["control", "audio", "video"]) {
      const ws = new WebSocket(
        `${protocol}//${location.host}/socket/${channel}`,
      );
      ws.binaryType = "arraybuffer";
      this.sockets.set(channel, ws);
      const current = () => this.sockets.get(channel) === ws;
      ws.onopen = () => {
        if (!current()) {
          ws.close();
          return;
        }
        ws.send(
          JSON.stringify({
            type: "auth",
            protocolVersion: PROTOCOL_VERSION,
            ...session,
            code: undefined,
          }),
        );
        if (channel === "control") {
          this.send({ type: "ping", clientTime: performance.now() });
        }
        this.connection.progress();
      };
      ws.onmessage = (event) => {
        if (!current()) return;
        if (typeof event.data === "string")
          this.message(JSON.parse(event.data));
        else if (channel === "audio") this.audio(event.data);
        else if (channel === "video") {
          const frame = event.data as ArrayBuffer;
          const decoded = decodeVideo(new Uint8Array(frame));
          if (
            !this.state ||
            !decoded ||
            decoded.epoch !== this.state.mediaEpoch
          )
            return;
          if (decoded.probe) {
            void this.video.probe(frame);
            return;
          }
          if (this.state.mediaMode === "rtc") return;
          this.video.pendingVideo = frame;
          void this.video.decodeVideo();
        }
      };
      ws.onclose = (event) => {
        if (current() && event.code === 4406) {
          this.leave();
          this.notify({
            error: "The game was updated. Refresh this page to continue.",
          });
          return;
        }
        if (current()) this.scheduleReconnect();
      };
      ws.onerror = () => {};
    }
    this.connectJudge();
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = setInterval(
      () => this.send({ type: "ping", clientTime: performance.now() }),
      10000,
    );
    if (this.statusTimer) clearInterval(this.statusTimer);
    this.statusTimer = setInterval(() => void this.reportHealth(), 1000);
  }
  private connectJudge(attempt = 0) {
    const session = this.session;
    if (!session || this.sockets.has("judge")) return;
    const ws = new WebSocket(
      `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/socket/judge`,
    );
    ws.binaryType = "arraybuffer";
    this.sockets.set("judge", ws);
    const current = () =>
      this.session === session && this.sockets.get("judge") === ws;
    const deadline = setTimeout(() => {
      if (current()) ws.close();
    }, 10000);
    let received = false;
    ws.onopen = () => {
      clearTimeout(deadline);
      if (!current()) return ws.close();
      ws.send(
        JSON.stringify({
          type: "auth",
          protocolVersion: PROTOCOL_VERSION,
          ...session,
          code: undefined,
        }),
      );
      this.playback.resetJudgePlayback();
    };
    ws.onmessage = (event) => {
      if (!current()) return;
      if (typeof event.data === "string") this.message(JSON.parse(event.data));
      else {
        received = true;
        this.playback.receive(event.data);
      }
    };
    ws.onclose = (event) => {
      clearTimeout(deadline);
      if (!current()) return;
      this.sockets.delete("judge");
      this.playback.stopJudge();
      if (event.code === 4406) {
        this.notify({
          error: "The game was updated. Refresh this page to continue.",
        });
        return;
      }
      // Repair this channel alone. Healthy microphones, cameras and friend chat stay mounted.
      const retry = received ? 0 : attempt;
      this.judgeRetry = setTimeout(
        () => this.connectJudge(retry + 1),
        retry < 3 ? 250 * 2 ** retry : 10000,
      );
    };
    ws.onerror = () => {};
  }
  reporting = false;
  async reportHealth() {
    if (this.reporting || !this.session || !this.state) return;
    this.reporting = true;
    const session = this.session;
    try {
      // Device/privacy failures must not wait for an asynchronous RTC stats read.
      void this.peer.sample();
      if (session !== this.session || !this.state) return;
      const audio = this.capture.stream?.getAudioTracks()[0],
        camera = this.capture.stream?.getVideoTracks()[0];
      this.command({
        type: "media_status",
        captureId: audio?.id || "",
        cameraId: camera?.id || "",
        micSource:
          !!audio &&
          audio.readyState === "live" &&
          !audio.muted &&
          !this.capture.captureFailed &&
          this.sound.context?.state === "running",
        mic:
          !!audio &&
          audio.readyState === "live" &&
          !audio.muted &&
          !this.capture.captureFailed &&
          !this.capture.micMuted &&
          this.sound.context?.state === "running" &&
          this.clock.synced,
        camera:
          !!camera &&
          camera.readyState === "live" &&
          !camera.muted &&
          !this.capture.cameraOff,
        foreground: !document.hidden,
        localFrames: this.video.localFrames,
        remoteFrames: this.peer.remoteFrames,
        cameraGeneration: this.video.captureGeneration,
        mediaEpoch: this.state.mediaEpoch,
        rtc: this.peer.pc?.connectionState === "connected",
        rtcFailed: ["failed", "disconnected", "closed"].includes(
          this.peer.pc?.connectionState || "",
        ),
      });
    } finally {
      this.reporting = false;
    }
  }

  async restore() {
    const saved = sessionStorage.getItem("hmo-seat");
    if (!saved) return;
    try {
      await this.connection.restore(saved);
    } catch {
      sessionStorage.removeItem("hmo-seat");
      this.notify({ error: "Your seat expired. Join a new court." });
    }
  }
  scheduleReconnect() {
    this.connection.lost();
  }
  async retryConnection() {
    if (
      this.session &&
      (await this.connection.open(this.session, undefined, 0, true))
    ) {
      if (this.setup.inline) await this.setup.run();
    }
  }
  send(data: unknown) {
    const ws = this.sockets.get("control");
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
  }
  command(command: Command) {
    if (!this.session || !this.state) return;
    if (
      this.reconnecting &&
      !["media_status", "setup_cancel", "leave"].includes(command.type)
    )
      return;
    const commandId = crypto.randomUUID();
    this.send({
      commandId,
      connectionEpoch: this.session.connectionEpoch,
      matchId: this.state.matchId,
      expectedPhaseVersion: this.state.phaseVersion,
      command,
    });
    return commandId;
  }
  message(raw: unknown) {
    const parsed = serverMessageSchema.safeParse(raw);
    if (!parsed.success) {
      this.notify({
        error: "The connection protocol changed. Refresh this page.",
      });
      return;
    }
    const data = parsed.data;
    if (data.type === "setup_result") {
      this.setup.result(data);
      return;
    }
    if (data.type === "video_ack") {
      if (data.mediaEpoch === this.state?.mediaEpoch)
        this.video.videoInFlight.delete(data.seq);
      return;
    }
    if (data.type === "pong") {
      this.clock.observe(data.serverNow, performance.now() - data.clientTime);
      this.connection.progress();
      return;
    }
    if (data.type === "activity") {
      // Local capture and RTC receiving own their meters. A delayed server
      // observation must not overwrite them or light up explicitly muted audio.
      if (
        data.playerId !== this.session?.playerId &&
        this.state?.mediaMode !== "rtc"
      )
        this.notify({
          activity: {
            ...data,
            level:
              this.sound.peerMuted ||
              this.capture.privateCheck() ||
              this.sound.context?.state !== "running"
                ? 0
                : data.level,
          },
        });
      return;
    }
    if (data.type === "signal") {
      void this.peer.signal(data);
      return;
    }
    if (data.type === "ack") {
      if (
        data.ok === false &&
        this.setup.busy &&
        data.commandId === this.setup.commandId
      ) {
        this.setup.result({
          type: "setup_result",
          checkId: this.setup.checkId,
          status: "failed",
          text: data.error || "Couldn’t start the check. Try again.",
        });
        return;
      }
      if (data.ok === false)
        this.notify({ error: data.error || "Request could not complete." });
      return;
    }
    if (data.type === "error") {
      this.notify({ error: data.error || "Request could not complete." });
      return;
    }
    if ("snapshot" in data) {
      if (this.session && data.snapshot.roomId !== this.session.roomId) return;
      if (
        this.state &&
        data.snapshot.seq < this.state.seq &&
        data.snapshot.roomId === this.state.roomId
      )
        return;
      if (
        this.state &&
        "seq" in data &&
        data.seq &&
        data.seq > this.state.seq + 1
      )
        this.send({ type: "snapshot_request" });
      if (this.state && this.state.mediaEpoch !== data.snapshot.mediaEpoch) {
        this.video.resetVideo();
        this.video.videoInFlight.clear();
        this.peer.remote = null;
      }
      const previousMode = this.state?.mediaMode;
      this.state = data.snapshot;
      this.connection.observe(data.snapshot);
      if (
        previousMode !== this.state?.mediaMode &&
        this.state?.mediaMode === "rtc"
      )
        this.sound.peerPlayback?.port.postMessage({ type: "flush" });

      this.peer.makePeer();
      this.capture.syncMicrophone();
      this.playback.updateSpeech();
      this.sound.syncPeerPrivacy();
      this.notify({
        state: data.snapshot,
        event: "seq" in data ? data : undefined,
      });
      if (data.type === "authenticated") this.connection.progress(true);
      if (data.type === "judge_cancelled") {
        const epoch = data.payload?.epoch;
        this.playback.cancelled.add(epoch);
        this.playback.judgeChunks.delete(epoch);
        this.playback.stopJudge();
      }
    }
  }
  audio(raw: ArrayBuffer) {
    if (!this.sound.context || raw.byteLength < 17) return;
    const bytes = new Uint8Array(raw);
    if (bytes[0] === 1 && this.state?.mediaMode !== "rtc") {
      const packet = decodeMicrophone(bytes);
      if (
        !packet ||
        packet.epoch !== this.state?.mediaEpoch ||
        this.capture.privateCheck() ||
        packet.purpose === "private" ||
        packet.purpose === "health" ||
        packet.end ||
        this.serverNow() - packet.capturedAt > 250
      )
        return;
      const shorts = new Int16Array(packet.pcm.slice().buffer),
        floats = new Float32Array(shorts.length);
      for (let i = 0; i < shorts.length; i++) floats[i] = shorts[i] / 32768;
      this.sound.peerPlayback?.port.postMessage({ pcm: floats.buffer }, [
        floats.buffer,
      ]);
    }
  }

  leave() {
    const departure = this.connection.departure();
    this.setup.cancel();
    if (departure) this.releaseSeat(departure);
    this.invalidateConnection();
    this.clock.reset();

    this.peer.reset();
    this.video.resetVideo();
    this.video.videoInFlight.clear();
    this.sound.peerPlayback?.port.postMessage({ type: "flush" });
    for (const timer of [
      this.video.frameTimer,
      this.statusTimer,
      this.pingTimer,
    ])
      if (timer) clearInterval(timer);
    this.playback.resetJudgePlayback();
    this.capture.stop();
    if (this.video.cameraVideo) {
      this.video.cameraVideo.srcObject = null;
      this.video.cameraVideo = null;
    }
    this.peer.pcEpoch = -1;
    this.peer.pendingCandidates = [];
    this.peer.pendingSignals = [];
    this.capture.worklet?.disconnect();
    this.capture.source?.disconnect();
    this.session = null;
    this.state = null;
    sessionStorage.removeItem("hmo-seat");
    this.notify({ connection: "left" });
  }
}
export const client = new Client();
