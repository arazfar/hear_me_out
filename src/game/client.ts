import {
  decodeJudgeAudio,
  decodeMicrophone,
  decodeVideo,
} from "../../shared/media";
import {
  PROTOCOL_VERSION,
  serverMessageSchema,
  type Session,
} from "../../shared/protocol";
import {
  canSpeak,
  type Command,
  type GameEvent,
  type Snapshot,
} from "../../shared/types";
import { DeviceCapture } from "../media/capture";
import { PeerMedia } from "../media/peer";
import { JudgePlayback } from "../media/playback";
import { ServerClock } from "../media/server-clock";
import { AudioOutput } from "../media/sound";
import { RelayVideo } from "../media/video";
export type Update = {
  state?: Snapshot;
  event?: GameEvent;
  error?: string;
  connection?: string;
  activity?: { playerId: string; level: number };
  media?: true;
};
export class Client {
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
  connectionGeneration = 0;
  connectionRequest: AbortController | null = null;
  invalidateConnection() {
    this.connectionGeneration++;
    this.connectionRequest?.abort();
    this.connectionRequest = null;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.reconnecting = false;
  }
  pingTimer: ReturnType<typeof setInterval> | null = null;
  statusTimer: ReturnType<typeof setInterval> | null = null;
  reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  disconnecting = false;
  reconnecting = false;
  listeners = new Set<(u: Update) => void>();
  on(update: (u: Update) => void) {
    this.listeners.add(update);
    return () => {
      this.listeners.delete(update);
    };
  }
  notify(u: Update) {
    for (const f of this.listeners) f(u);
  }
  async enter(kind: "create" | "join", name: string, code?: string) {
    if (this.session) this.leave();
    this.invalidateConnection();
    const generation = this.connectionGeneration;
    const request = (this.connectionRequest = new AbortController());
    await this.sound.unlock();
    if (generation !== this.connectionGeneration) return;
    const response = await fetch(
      kind === "create" ? "/api/rooms" : "/api/join",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, code }),
        signal: request.signal,
      },
    );
    const body = await response.json();
    if (generation !== this.connectionGeneration) return;
    if (!response.ok) throw new Error(body.error);
    this.attach(body.session, body.snapshot);
    try {
      await this.capture.devices();
    } catch {
      this.notify({
        error:
          "Microphone permission is needed. Allow it in Chrome’s site controls, then click Enable devices.",
      });
    }
  }
  attach(session: Session, snapshot: Snapshot) {
    this.clock.reset();
    const generation = this.connectionGeneration;
    this.disconnecting = false;
    this.session = session;
    this.state = snapshot;
    this.capture.syncMicrophone();
    this.capture.audioSeq = 0;
    sessionStorage.setItem("hmo-seat", JSON.stringify(session));
    this.notify({ state: snapshot, connection: "connecting" });
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    for (const channel of ["control", "audio", "video"]) {
      const ws = new WebSocket(
        `${protocol}//${location.host}/socket/${channel}`,
      );
      ws.binaryType = "arraybuffer";
      this.sockets.set(channel, ws);
      const current = () =>
        generation === this.connectionGeneration &&
        this.sockets.get(channel) === ws;
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
          this.notify({ connection: "connected" });
          this.send({ type: "ping", clientTime: performance.now() });
        }
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
            this.state.mediaMode === "rtc" ||
            !decoded ||
            decoded.epoch !== this.state.mediaEpoch
          )
            return;
          const seq = decoded.seq;
          const ack = () =>
            this.send({
              type: "video_ack",
              seq,
              mediaEpoch: new DataView(frame).getUint32(1, true),
            });
          ack();
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
        if (!this.disconnecting && current()) this.scheduleReconnect();
      };
      ws.onerror = () => {};
    }
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = setInterval(
      () => this.send({ type: "ping", clientTime: performance.now() }),
      10000,
    );
    if (this.statusTimer) clearInterval(this.statusTimer);
    this.statusTimer = setInterval(
      () =>
        this.command({
          type: "media_status",
          ready:
            this.clock.synced &&
            !!this.capture.stream &&
            this.sound.context?.state === "running",
          cameraOn:
            !this.capture.cameraOff &&
            !!this.capture.stream?.getVideoTracks().length,
          rtc: this.peer.pc?.connectionState === "connected",
        }),
      1200,
    );
  }
  async restore() {
    this.invalidateConnection();
    const generation = this.connectionGeneration;
    const request = (this.connectionRequest = new AbortController());
    const saved = sessionStorage.getItem("hmo-seat");
    if (!saved) return;
    try {
      const response = await fetch("/api/resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: saved,
        signal: request.signal,
      });
      const body = await response.json();
      if (generation !== this.connectionGeneration) return;
      if (!response.ok) {
        sessionStorage.removeItem("hmo-seat");
        throw new Error(body.error);
      }
      this.attach(body.session, body.snapshot);
      void this.capture.devices().catch(() =>
        this.notify({
          error:
            "Your seat is restored. Click Enable devices to resume camera and microphone.",
        }),
      );
    } catch (e) {
      if (generation !== this.connectionGeneration) return;
      this.notify({
        error: e instanceof Error ? e.message : "Could not reconnect.",
      });
    }
  }
  scheduleReconnect() {
    if (this.reconnectTimer || this.reconnecting || !this.session) return;
    const generation = this.connectionGeneration;
    const session = this.session;
    const request = (this.connectionRequest = new AbortController());
    this.notify({ connection: "reconnecting" });
    this.playback.stopJudge();
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (generation !== this.connectionGeneration) return;
      this.reconnecting = true;
      try {
        const response = await fetch("/api/resume", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(session),
          signal: request.signal,
        });
        const body = await response.json();
        if (generation !== this.connectionGeneration) return;
        if (!response.ok) {
          if (response.status === 401) {
            this.leave();
            this.notify({
              error:
                "The demo server restarted or your seat expired. Create or join a fresh room.",
            });
            return;
          }
          throw new Error(body.error);
        }
        this.disconnecting = true;
        for (const ws of this.sockets.values()) ws.close();
        this.sockets.clear();
        this.peer.pc?.close();
        this.peer.pc = null;
        this.peer.pcEpoch = -1;
        this.video.resetVideo();
        this.attach(body.session, body.snapshot);
      } catch {
        if (generation !== this.connectionGeneration) return;
        this.reconnecting = false;
        this.scheduleReconnect();
      } finally {
        if (generation === this.connectionGeneration) this.reconnecting = false;
      }
    }, 1000);
  }
  send(data: unknown) {
    const ws = this.sockets.get("control");
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
  }
  command(command: Command) {
    if (!this.session || !this.state) return;
    this.send({
      commandId: crypto.randomUUID(),
      connectionEpoch: this.session.connectionEpoch,
      matchId: this.state.matchId,
      expectedPhaseVersion: this.state.phaseVersion,
      command,
    });
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
    if (data.type === "video_ack") {
      if (data.mediaEpoch === this.state?.mediaEpoch)
        this.video.videoInFlight.delete(data.seq);
      return;
    }
    if (data.type === "pong") {
      this.clock.observe(data.serverNow, performance.now() - data.clientTime);
      return;
    }
    if (data.type === "activity") {
      this.notify({ activity: data });
      return;
    }
    if (data.type === "signal") {
      void this.peer.signal(data);
      return;
    }
    if (data.type === "ack") {
      if (data.ok === false)
        this.notify({ error: data.error || "Request could not complete." });
      return;
    }
    if (data.type === "error") {
      this.notify({ error: data.error || "Request could not complete." });
      return;
    }
    if ("snapshot" in data) {
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
      const wasPeerAllowed = canSpeak(
        this.state,
        this.state?.players.find((p) => p.id !== this.session?.playerId)?.id ||
          null,
      );
      const previousMode = this.state?.mediaMode;
      this.state = data.snapshot;
      if (
        previousMode !== this.state?.mediaMode &&
        this.state?.mediaMode === "rtc"
      )
        this.sound.peerPlayback?.port.postMessage({ type: "flush" });

      this.peer.makePeer();
      this.capture.syncMicrophone();
      this.playback.updateSpeech();
      this.sound.peerGain?.gain.setTargetAtTime(
        this.sound.peerMuted ||
          !canSpeak(
            this.state,
            this.state?.players.find((p) => p.id !== this.session?.playerId)
              ?.id || null,
          )
          ? 0
          : 1,
        this.sound.context!.currentTime,
        0.01,
      );
      if (
        wasPeerAllowed !==
        canSpeak(
          this.state,
          this.state?.players.find((p) => p.id !== this.session?.playerId)
            ?.id || null,
        )
      )
        this.sound.peerPlayback?.port.postMessage({ type: "flush" });
      this.notify({
        state: data.snapshot,
        event: "seq" in data ? data : undefined,
      });
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
        !canSpeak(
          this.state,
          this.state?.players.find((p) => p.id !== this.session?.playerId)
            ?.id || null,
        ) ||
        this.serverNow() - packet.capturedAt > 250
      )
        return;
      const shorts = new Int16Array(packet.pcm.slice().buffer),
        floats = new Float32Array(shorts.length);
      for (let i = 0; i < shorts.length; i++) floats[i] = shorts[i] / 32768;
      this.sound.peerPlayback?.port.postMessage({ pcm: floats.buffer }, [
        floats.buffer,
      ]);
    } else if (bytes[0] === 2) {
      const packet = decodeJudgeAudio(bytes),
        judge = this.state?.judge;
      if (
        !packet ||
        (judge &&
          (packet.epoch < judge.epoch ||
            packet.epoch > judge.epoch + 4 ||
            (packet.epoch === judge.epoch && judge.status === "silent"))) ||
        this.playback.cancelled.has(packet.epoch)
      )
        return;
      if (
        !this.playback.judgeChunks.has(packet.epoch) &&
        this.playback.judgeChunks.size >= 2
      )
        return;
      const chunks = this.playback.judgeChunks.get(packet.epoch) || [];
      if (
        chunks.some((c) => c.offset === packet.offset) ||
        chunks.reduce((n, c) => n + c.pcm.length, 0) + packet.pcm.length >
          44100 * 8
      )
        return;
      chunks.push({ offset: packet.offset, pcm: packet.pcm });
      this.playback.judgeChunks.set(packet.epoch, chunks);
      this.playback.updateSpeech();
    }
  }
  leave() {
    this.command({ type: "leave" });
    this.invalidateConnection();
    this.clock.reset();
    this.disconnecting = true;
    for (const ws of this.sockets.values()) ws.close();
    this.sockets.clear();
    this.peer.pc?.close();
    this.peer.pc = null;
    this.peer.remote = null;
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
    this.capture.stream?.getTracks().forEach((t) => t.stop());
    this.capture.stream = null;
    this.capture.deviceRequest = null;
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
