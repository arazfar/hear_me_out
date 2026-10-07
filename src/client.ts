import { canSpeak, type Command, type GameEvent, type Snapshot } from "../shared/types";
export interface Session {
  roomId: string;
  playerId: string;
  token: string;
  connectionEpoch: number;
  code: string;
}
export type Update = {
  state?: Snapshot;
  event?: GameEvent;
  error?: string;
  connection?: string;
  activity?: { playerId: string; level: number };
  media?: true;
};
export class Client {
  session: Session | null = null;
  state: Snapshot | null = null;
  stream: MediaStream | null = null;
  remote: MediaStream | null = null;
  remoteFrame = false;
  remoteCanvas: HTMLCanvasElement | null = null;
  remoteFrameAt = 0;
  pendingVideo: ArrayBuffer | null = null;
  decodingVideo = false;
  videoGeneration = 0;
  remoteFrameSeq = 0;
  micLevel = 0;
  micMuted = false;
  cameraOff = false;
  peerMuted = false;
  judgeMuted = false;
  musicMuted = true;
  context: AudioContext | null = null;
  peerGain: GainNode | null = null;
  peerPlayback: AudioWorkletNode | null = null;
  judgeGain: GainNode | null = null;
  analyser: AnalyserNode | null = null;
  analysisData = new Uint8Array(128);
  judgeAmplitude() {
    if (!this.analyser) return 0;
    this.analyser.getByteTimeDomainData(this.analysisData);
    let total = 0;
    for (const x of this.analysisData) total += ((x - 128) / 128) ** 2;
    return Math.sqrt(total / 128);
  }
  capture: AudioWorkletNode | null = null;
  source: MediaStreamAudioSourceNode | null = null;
  sockets = new Map<string, WebSocket>();
  pc: RTCPeerConnection | null = null;
  pcEpoch = -1;
  makingOffer = false;
  ignoreOffer = false;
  pendingCandidates: RTCIceCandidateInit[] = [];
  pendingSignals: any[] = [];
  audioSeq = 0;
  videoSeq = 0;
  videoInFlight = new Map<number, number>();
  peerTime = 0;
  offset = 0;
  judgeChunks = new Map<number, { offset: number; pcm: Float32Array }[]>();
  cancelled = new Set<number>();
  readySent = new Set<number>();
  played = new Set<string>();
  nodes = new Set<AudioBufferSourceNode>();
  judgeStartContext = new Map<number, number>();
  bargeEpoch = -1;
  frameTimer: ReturnType<typeof setInterval> | null = null;
  pingTimer: ReturnType<typeof setInterval> | null = null;
  statusTimer: ReturnType<typeof setInterval> | null = null;
  reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  disconnecting = false;
  reconnecting = false;
  cameraVideo: HTMLVideoElement | null = null;
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
  deviceRequest: Promise<void> | null = null;
  devices(camera = true): Promise<void> {
    if (this.deviceRequest) {
      // A user gesture may unblock the existing autoplay-suspended request.
      void this.context?.resume().catch(() => {});
      return this.deviceRequest;
    }
    const request = this.acquireDevices(camera);
    this.deviceRequest = request;
    const clear = () => { if (this.deviceRequest === request) this.deviceRequest = null; };
    void request.then(clear, clear);
    return request;
  }
  private async acquireDevices(camera = true) {
    await this.unlock();
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
        this.stream.addTrack(video.getVideoTracks()[0]);
        this.cameraOff = false;
        this.syncMicrophone();
        this.prepareVideo();
        this.pc?.addTrack(video.getVideoTracks()[0], this.stream);
      }
      this.notify({ media: true });
      return;
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
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
        this.stream = await navigator.mediaDevices.getUserMedia({
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
    await this.context!.audioWorklet.addModule("/pcm-worklet.js");
    this.source = this.context!.createMediaStreamSource(
      new MediaStream(this.stream.getAudioTracks()),
    );
    this.capture = new AudioWorkletNode(this.context!, "pcm-capture");
    const silence = this.context!.createGain();
    silence.gain.value = 0;
    this.source
      .connect(this.capture)
      .connect(silence)
      .connect(this.context!.destination);
    let levelAt = 0;
    this.capture.port.onmessage = ({ data }) => {
      const allowed = this.microphoneAllowed();
      this.micLevel = allowed ? data.level : 0;
      if (Date.now() - levelAt > 100) {
        levelAt = Date.now();
        if (this.session)
          this.notify({
            activity: {
              playerId: this.session.playerId,
              level: Math.min(1, this.micLevel * 8),
            },
          });
        else this.notify({ media: true });
      }
      const audio = this.sockets.get("audio");
      if (
        !audio ||
        audio.readyState !== WebSocket.OPEN ||
        audio.bufferedAmount > 8000
      )
        return;
      const packet = new ArrayBuffer(25 + data.pcm.byteLength),
        header = new DataView(packet);
      header.setUint8(0, 1);
      header.setUint32(1, this.state?.mediaEpoch || 0, true);
      header.setUint32(5, ++this.audioSeq, true);
      header.setUint32(9, 16000, true);
      header.setUint32(13, 320, true);
      header.setFloat64(17, Date.now() + this.offset, true);
      if (allowed)
        new Uint8Array(packet, 25).set(new Uint8Array(data.pcm));
      audio.send(packet);

    };
    this.syncMicrophone();
    this.prepareVideo();
    if (this.state) {
      this.makePeer();
      for (const data of this.pendingSignals.splice(0)) await this.signal(data);
    }
    this.notify({ media: true });
  }
  async unlock() {
    if (!this.context) {
      this.context = new AudioContext();
      this.peerGain = this.context.createGain();
      this.judgeGain = this.context.createGain();
      this.peerGain.connect(this.context.destination);
      await this.context.audioWorklet.addModule("/peer-worklet.js");
      this.peerPlayback = new AudioWorkletNode(this.context, "peer-playback", {
        numberOfInputs: 0,
        outputChannelCount: [1],
      });
      this.peerPlayback.connect(this.peerGain);
      this.judgeGain.connect(this.context.destination);
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = 256;
      const silent = this.context.createGain();
      silent.gain.value = 0;
      this.judgeGain
        .connect(this.analyser)
        .connect(silent)
        .connect(this.context.destination);
    }
    await this.context.resume();
  }
  microphoneAllowed() {
    return !this.micMuted && canSpeak(this.state, this.session?.playerId || null);
  }
  syncMicrophone() {
    this.stream?.getAudioTracks().forEach(t => { t.enabled = this.microphoneAllowed(); });
  }
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
          bitmap = await createImageBitmap(new Blob([frame.slice(17)], {type: "image/jpeg"}));
          const seq = header.getUint32(5, true);
          if (generation !== this.videoGeneration || header.getUint32(1, true) !== this.state?.mediaEpoch || seq <= this.remoteFrameSeq) continue;
          this.remoteCanvas ||= document.createElement("canvas");
          if (this.remoteCanvas.width !== 256) this.remoteCanvas.width = 256;
          if (this.remoteCanvas.height !== 144) this.remoteCanvas.height = 144;
          this.remoteCanvas.getContext("2d")!.drawImage(bitmap, 0, 0, 256, 144);
          this.remoteFrameSeq = seq;
          this.remoteFrame = true;
          this.remoteFrameAt = Date.now();
          this.notify({media: true});
        } catch { /* Keep the last good frame; the next frame can recover. */ }
        finally { bitmap?.close(); }
      }
    } finally { this.decodingVideo = false; }
  }
  prepareVideo() {
    if (!this.stream) return;
    this.cameraVideo = document.createElement("video");
    this.cameraVideo.muted = true;
    this.cameraVideo.playsInline = true;
    this.cameraVideo.srcObject = this.stream;
    void this.cameraVideo.play().catch(() => {});
    if (this.frameTimer) clearInterval(this.frameTimer);
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 144;
    const ctx = canvas.getContext("2d")!;
    let encoding = false;
    this.frameTimer = setInterval(() => {
      const ws = this.sockets.get("video");
      if (
        !this.state ||
        this.state.mediaMode === "rtc" ||
        this.cameraOff ||
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
      const capturedAt = Date.now() + this.offset;
      const mediaEpoch = this.state.mediaEpoch;
      ctx.drawImage(this.cameraVideo, 0, 0, 256, 144);
      canvas.toBlob(
        async (blob) => {
          try {
            if (!blob || this.state?.mediaEpoch !== mediaEpoch) return;
            const data = await blob.arrayBuffer();
            const packet = new ArrayBuffer(17 + data.byteLength),
              view = new DataView(packet);
            view.setUint8(0, 3);
            view.setUint32(1, mediaEpoch, true);
            view.setUint32(5, ++this.videoSeq, true);
            view.setFloat64(9, capturedAt, true);
            new Uint8Array(packet, 17).set(new Uint8Array(data));
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
  async enter(kind: "create" | "join", name: string, code?: string) {
    await this.unlock();
    const response = await fetch(
      kind === "create" ? "/api/rooms" : "/api/join",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, code }),
      },
    );
    const body = await response.json();
    if (!response.ok) throw new Error(body.error);
    this.attach(body.session, body.snapshot);
    try {
      await this.devices();
    } catch {
      this.notify({
        error:
          "Microphone permission is needed. Allow it in Chrome’s site controls, then click Enable devices.",
      });
    }
  }
  attach(session: Session, snapshot: Snapshot) {
    this.disconnecting = false;
    this.session = session;
    this.state = snapshot;
    this.syncMicrophone();
    this.audioSeq = 0;
    sessionStorage.setItem("hmo-seat", JSON.stringify(session));
    this.notify({ state: snapshot, connection: "connecting" });
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    for (const channel of ["control", "audio", "video"]) {
      const ws = new WebSocket(
        `${protocol}//${location.host}/socket/${channel}`,
      );
      ws.binaryType = "arraybuffer";
      this.sockets.set(channel, ws);
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: "auth", ...session, code: undefined }));
        if (channel === "control") {
          this.notify({ connection: "connected" });
          this.send({ type: "ping", clientTime: Date.now() });
        }
      };
      ws.onmessage = (event) => {
        if (typeof event.data === "string")
          this.message(JSON.parse(event.data));
        else if (channel === "audio") this.audio(event.data);
        else if (channel === "video") {
          const frame = event.data as ArrayBuffer;
          if (
            !this.state ||
            this.state.mediaMode === "rtc" ||
            frame.byteLength < 17 ||
            new DataView(frame).getUint32(1, true) !== this.state.mediaEpoch
          )
            return;
          const seq = new DataView(frame).getUint32(5, true);
          const ack = () =>
            this.send({
              type: "video_ack",
              seq,
              mediaEpoch: new DataView(frame).getUint32(1, true),
            });
          ack();
          this.pendingVideo = frame;
          void this.decodeVideo();
        }
      };
      ws.onclose = () => {
        if (!this.disconnecting && this.sockets.get(channel) === ws)
          this.scheduleReconnect();
      };
      ws.onerror = () => {};
    }
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = setInterval(
      () => this.send({ type: "ping", clientTime: Date.now() }),
      10000,
    );
    if (this.statusTimer) clearInterval(this.statusTimer);
    this.statusTimer = setInterval(
      () =>
        this.command({
          type: "media_status",
          ready: !!this.stream && this.context?.state === "running",
          cameraOn: !this.cameraOff && !!this.stream?.getVideoTracks().length,
          rtc: this.pc?.connectionState === "connected",
        }),
      1200,
    );
  }
  async restore() {
    const saved = sessionStorage.getItem("hmo-seat");
    if (!saved) return;
    try {
      const response = await fetch("/api/resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: saved,
      });
      const body = await response.json();
      if (!response.ok) {
        sessionStorage.removeItem("hmo-seat");
        throw new Error(body.error);
      }
      this.attach(body.session, body.snapshot);
      void this.devices().catch(() => this.notify({error: "Your seat is restored. Click Enable devices to resume camera and microphone."}));
    } catch (e) {
      this.notify({
        error: e instanceof Error ? e.message : "Could not reconnect.",
      });
    }
  }
  scheduleReconnect() {
    if (this.reconnectTimer || this.reconnecting || !this.session) return;
    this.notify({ connection: "reconnecting" });
    this.stopJudge();
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      this.reconnecting = true;
      try {
        const response = await fetch("/api/resume", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(this.session),
        });
        const body = await response.json();
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
        this.pc?.close();
        this.pc = null;
        this.pcEpoch = -1;
        this.resetVideo();
        this.attach(body.session, body.snapshot);
      } catch {
        this.reconnecting = false;
        this.scheduleReconnect();
      } finally {
        this.reconnecting = false;
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
  message(data: any) {
    if (data.type === "video_ack") {
      if (data.mediaEpoch === this.state?.mediaEpoch)
        this.videoInFlight.delete(data.seq);
      return;
    }
    if (data.type === "pong") {
      this.offset = data.serverNow - (data.clientTime + Date.now()) / 2;
      return;
    }
    if (data.type === "activity") {
      this.notify({ activity: data });
      return;
    }
    if (data.type === "signal") {
      void this.signal(data);
      return;
    }
    if (data.type === "ack") {
      if (data.ok === false) this.notify({ error: data.error });
      return;
    }
    if (data.type === "error") {
      this.notify({ error: data.error });
      return;
    }
    if (data.snapshot) {
      if (
        this.state &&
        data.snapshot.seq < this.state.seq &&
        data.snapshot.roomId === this.state.roomId
      )
        return;
      if (this.state && data.seq && data.seq > this.state.seq + 1)
        this.send({ type: "snapshot_request" });
      if (this.state && this.state.mediaEpoch !== data.snapshot.mediaEpoch) {
        this.resetVideo();
        this.videoInFlight.clear();
        this.remote = null;
      }
      const wasPeerAllowed = canSpeak(this.state, this.state?.players.find(p => p.id !== this.session?.playerId)?.id || null);
      const previousMode = this.state?.mediaMode;
      this.state = data.snapshot;
      if (
        previousMode !== this.state?.mediaMode &&
        this.state?.mediaMode === "rtc"
      )
        this.peerPlayback?.port.postMessage({ type: "flush" });
      this.offset = this.offset || data.snapshot.serverNow - Date.now();
      this.makePeer();
      this.syncMicrophone();
      this.updateSpeech();
      this.peerGain?.gain.setTargetAtTime(
        this.peerMuted || !canSpeak(this.state, this.state?.players.find(p => p.id !== this.session?.playerId)?.id || null) ? 0 : 1,
        this.context!.currentTime, 0.01,
      );
      if (wasPeerAllowed !== canSpeak(this.state, this.state?.players.find(p => p.id !== this.session?.playerId)?.id || null))
        this.peerPlayback?.port.postMessage({ type: "flush" });
      this.notify({ state: data.snapshot, event: data.seq ? data : undefined });
      if (data.type === "judge_cancelled") {
        const epoch = data.payload?.epoch;
        this.cancelled.add(epoch);
        this.judgeChunks.delete(epoch);
        this.stopJudge();
      }
    }
  }
  makePeer() {
    if (
      !this.state ||
      !this.session ||
      !this.stream ||
      this.state.players.length < 2 ||
      !this.state.players.every((p) => p.captureReady) ||
      this.sockets.get("control")?.readyState !== WebSocket.OPEN
    )
      return;
    if (this.state.mediaMode === "wss") {
      this.pc?.close();
      this.pc = null;
      this.remote = null;
      return;
    }
    if (this.pc && this.pcEpoch === this.state.mediaEpoch) return;
    this.pc?.close();
    this.pcEpoch = this.state.mediaEpoch;
    this.pendingCandidates = [];
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });
    this.pc = pc;
    this.stream.getTracks().forEach((track) => {
      const sender = pc.addTrack(track, this.stream!);
      if (track.kind === "video") {
        const params = sender.getParameters();
        params.encodings = [{ maxBitrate: 450000, maxFramerate: 24 }];
        void sender.setParameters(params).catch(() => {});
      }
    });
    for (const data of this.pendingSignals.splice(0)) void this.signal(data);
    pc.onicecandidate = ({ candidate }) => {
      if (candidate)
        this.send({
          type: "signal",
          mediaEpoch: this.pcEpoch,
          candidate: candidate.toJSON(),
        });
    };
    pc.ontrack = ({ streams, track }) => {
      this.remote = streams[0] || new MediaStream([track]);
      this.notify({ media: true });
    };
    pc.onconnectionstatechange = () => {
      this.notify({ media: true });
      this.command({
        type: "media_status",
        ready: true,
        cameraOn: !this.cameraOff,
        rtc: pc.connectionState === "connected",
      });
    };
    pc.onnegotiationneeded = async () => {
      try {
        this.makingOffer = true;
        await pc.setLocalDescription();
        this.send({
          type: "signal",
          mediaEpoch: this.pcEpoch,
          description: pc.localDescription,
        });
      } catch {
      } finally {
        this.makingOffer = false;
      }
    };
  }
  async signal(data: any) {
    this.makePeer();
    const pc = this.pc;
    if (!pc) {
      if (this.pendingSignals.length < 64) this.pendingSignals.push(data);
      return;
    }
    if (data.mediaEpoch !== this.pcEpoch) return;
    const polite = this.state!.players[1]?.id === this.session!.playerId;
    try {
      if (data.description) {
        const collision =
          data.description.type === "offer" &&
          (this.makingOffer || pc.signalingState !== "stable");
        this.ignoreOffer = !polite && collision;
        if (this.ignoreOffer) return;
        await pc.setRemoteDescription(data.description);
        for (const candidate of this.pendingCandidates)
          await pc.addIceCandidate(candidate);
        this.pendingCandidates = [];
        if (data.description.type === "offer") {
          await pc.setLocalDescription();
          this.send({
            type: "signal",
            mediaEpoch: this.pcEpoch,
            description: pc.localDescription,
          });
        }
      } else if (data.candidate) {
        if (pc.remoteDescription) await pc.addIceCandidate(data.candidate);
        else this.pendingCandidates.push(data.candidate);
      }
    } catch {
      /* WSS recovery is server selected after the connection deadline. */
    }
  }
  audio(raw: ArrayBuffer) {
    if (!this.context || raw.byteLength < 17) return;
    const view = new DataView(raw),
      kind = view.getUint8(0),
      rate = view.getUint32(9, true);
    if (kind === 1 && this.state?.mediaMode !== "rtc") {
      if (!canSpeak(this.state, this.state?.players.find(p => p.id !== this.session?.playerId)?.id || null)) return;
      const headerBytes = raw.byteLength - view.getUint32(13, true) * 2;
      if (headerBytes !== 17 && headerBytes !== 25) return;
      if (
        headerBytes === 25 &&
        Date.now() + this.offset - view.getFloat64(17, true) > 250
      )
        return;
      const shorts = new Int16Array(raw.slice(headerBytes)),
        floats = new Float32Array(shorts.length);
      for (let i = 0; i < shorts.length; i++) floats[i] = shorts[i] / 32768;
      if (rate === 16000)
        this.peerPlayback?.port.postMessage({ pcm: floats.buffer }, [
          floats.buffer,
        ]);
    } else if (kind === 2) {
      const epoch = view.getUint32(1, true);
      if (this.cancelled.has(epoch)) return;
      const chunks = this.judgeChunks.get(epoch) || [];
      chunks.push({
        offset: view.getUint32(13, true),
        pcm: new Float32Array(raw.slice(17)),
      });
      if (chunks.reduce((n, c) => n + c.pcm.length, 0) > 44100 * 8) return;
      this.judgeChunks.set(epoch, chunks);
      this.updateSpeech();
    }
  }
  updateSpeech() {
    const s = this.state?.judge;
    if (!s || !this.context || this.cancelled.has(s.epoch)) return;
    const chunks = this.judgeChunks.get(s.epoch);
    if (!chunks?.length) return;
    if (!this.readySent.has(s.epoch)) {
      this.readySent.add(s.epoch);
      this.command({
        type: "audio_ready",
        utteranceId: s.id,
        speechEpoch: s.epoch,
      });
    }
    if (s.status !== "speaking" || s.startAt === null) return;
    if (!this.judgeStartContext.has(s.epoch))
      this.judgeStartContext.set(
        s.epoch,
        this.context.currentTime +
          (s.startAt - Date.now() - this.offset) / 1000,
      );
    for (const c of chunks) {
      const key = `${s.epoch}:${c.offset}`;
      if (this.played.has(key)) continue;
      this.played.add(key);
      const at = Math.max(
        this.context.currentTime + 0.015,
        this.judgeStartContext.get(s.epoch)! + c.offset / 44100,
      );
      this.play(c.pcm, 44100, at, this.judgeGain!, true);
      if (c.offset === 0) {
        setTimeout(() => {
          if (this.cancelled.has(s.epoch) || this.state?.judge?.epoch !== s.epoch) return;
          const now = Date.now() + this.offset;
          this.send({type:"playback_metric",latencyMs:Math.max(0,now-s.startAt!),cueToPlaybackMs:s.cueAt ? Math.max(0,now-s.cueAt) : undefined,turnDoneToPlaybackMs:s.turnDoneAt ? Math.max(0,now-s.turnDoneAt) : undefined});
        }, Math.max(0,(at-this.context.currentTime)*1000));
      }
    }
    for (const epoch of this.judgeChunks.keys())
      if (epoch < s.epoch - 1) this.judgeChunks.delete(epoch);
  }
  play(
    samples: Float32Array,
    rate: number,
    at: number,
    gain: GainNode,
    judge: boolean,
  ) {
    const buffer = this.context!.createBuffer(1, samples.length, rate);
    buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
    const source = this.context!.createBufferSource();
    source.buffer = buffer;
    source.connect(gain);
    source.start(at);
    if (judge) {
      this.nodes.add(source);
      source.onended = () => this.nodes.delete(source);
    }
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
    this.bargeEpoch = -1;
  }
  muteMic() {
    this.micMuted = !this.micMuted;
    this.syncMicrophone();
    this.notify({ media: true });
  }
  muteCamera() {
    if (!this.stream?.getVideoTracks().length) {
      void this.devices(true).catch(() =>
        this.notify({
          error:
            "Allow camera in Chrome’s site controls, then try Camera again.",
        }),
      );
      return;
    }
    this.cameraOff = !this.cameraOff;
    this.stream?.getVideoTracks().forEach((t) => (t.enabled = !this.cameraOff));
    this.notify({ media: true });
  }
  mutePeer() {
    this.peerMuted = !this.peerMuted;
    if (this.peerGain && this.context)
      this.peerGain.gain.value = this.peerMuted || !canSpeak(this.state, this.state?.players.find(p => p.id !== this.session?.playerId)?.id || null) ? 0 : 1;
    this.notify({ media: true });
  }
  muteJudge() {
    this.judgeMuted = !this.judgeMuted;
    if (this.judgeGain) this.judgeGain.gain.value = this.judgeMuted ? 0 : 1;
    this.notify({ media: true });
  }
  effect(kind: "coin" | "score" | "verdict") {
    if (!this.context || this.context.state !== "running" || this.judgeMuted)
      return;
    if (kind === "score") {
      const noise = this.context.createBuffer(
        1,
        Math.floor(this.context.sampleRate * 0.07),
        this.context.sampleRate,
      );
      const samples = noise.getChannelData(0);
      for (let i = 0; i < samples.length; i++)
        samples[i] = (Math.random() * 2 - 1) * (1 - i / samples.length);
      const pop = this.context.createBufferSource(),
        filter = this.context.createBiquadFilter(),
        gain = this.context.createGain();
      pop.buffer = noise;
      filter.type = "lowpass";
      filter.frequency.value = 1600;
      gain.gain.value = 0.045;
      pop.connect(filter).connect(gain).connect(this.context.destination);
      pop.start();
    }
    const freqs =
      kind === "coin"
        ? [220, 880]
        : kind === "score"
          ? [523, 784]
          : [392, 523, 659, 784];
    freqs.forEach((f, i) => {
      const o = this.context!.createOscillator(),
        g = this.context!.createGain(),
        at =
          this.context!.currentTime + (kind === "score" ? 0.16 : 0) + i * 0.075;
      o.type = kind === "coin" ? "triangle" : "sine";
      o.frequency.value = f;
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(0.05, at + 0.008);
      g.gain.exponentialRampToValueAtTime(0.001, at + 0.18);
      o.connect(g).connect(this.context!.destination);
      o.start(at);
      o.stop(at + 0.2);
    });
  }
  leave() {
    this.command({ type: "leave" });
    this.disconnecting = true;
    for (const ws of this.sockets.values()) ws.close();
    this.sockets.clear();
    this.pc?.close();
    this.pc = null;
    this.remote = null;
    this.resetVideo();
    this.videoInFlight.clear();
    this.peerPlayback?.port.postMessage({ type: "flush" });
    for (const timer of [this.frameTimer, this.statusTimer, this.pingTimer])
      if (timer) clearInterval(timer);
    this.resetJudgePlayback();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.capture?.disconnect();
    this.source?.disconnect();
    this.session = null;
    this.state = null;
    sessionStorage.removeItem("hmo-seat");
    this.notify({ connection: "left" });
  }
}
export const client = new Client();
