import { type Signal } from "../../shared/protocol";
import type { Client } from "../game/client";
export class PeerMedia {
  constructor(readonly client: Client) {}
  remote: MediaStream | null = null;
  audioSender: RTCRtpSender | null = null;
  private desiredAudio: MediaStreamTrack | null = null;
  private audioSync: Promise<void> = Promise.resolve();
  remoteFrames = 0;
  remoteAudio: MediaStreamAudioSourceNode | null = null;
  private remoteAudioTrack: MediaStreamTrack | null = null;
  reset() {
    this.remoteAudio?.disconnect();
    this.remoteAudio = null;
    this.remoteAudioTrack = null;
    this.audioSender = null;
    this.desiredAudio = null;
    this.audioSync = Promise.resolve();
    this.pc?.close();
    this.pc = null;
    this.pcEpoch = -1;
    this.remote = null;
    this.remoteFrames = 0;
  }
  syncAudio() {
    const sender = this.audioSender;
    if (!sender) return;
    const desired =
      this.client.capture.microphoneAllowed() &&
      !this.client.setup.busy &&
      !this.client.setup.inline
        ? this.client.capture.stream?.getAudioTracks()[0] || null
        : null;
    if (desired === this.desiredAudio) return;
    this.desiredAudio = desired;
    // Detach the RTC sender during checks without changing the capture source.
    // A null sender keeps the private test off the peer connection.
    this.audioSync = this.audioSync.then(async () => {
      if (sender !== this.audioSender) return;
      try {
        await sender.replaceTrack(this.desiredAudio);
      } catch {
        if (sender !== this.audioSender) return;
        this.pc?.close();
        void this.client.reportHealth();
      }
    });
  }
  private syncRemote(pc: RTCPeerConnection) {
    if (pc !== this.pc) return;
    // Safari can retain a muted stream from a rolled-back offer. Receivers own
    // the live tracks; do not keep displaying that obsolete event stream.
    const selected = new Map<string, MediaStreamTrack>();
    for (const receiver of pc.getReceivers()) {
      const track = receiver.track,
        previous = selected.get(track.kind);
      if (
        track.readyState === "live" &&
        (!previous || previous.muted || !track.muted)
      )
        selected.set(track.kind, track);
    }
    const tracks = [...selected.values()];
    if (!tracks.length) return;
    const old = this.remote?.getTracks() || [];
    if (tracks.length !== old.length || tracks.some((t) => !old.includes(t))) {
      this.remote = new MediaStream(tracks);
      this.client.notify({ media: true });
    }
    const audio = selected.get("audio");
    if (
      audio &&
      audio !== this.remoteAudioTrack &&
      this.client.sound.context &&
      this.client.sound.peerGain
    ) {
      this.remoteAudio?.disconnect();
      this.remoteAudioTrack = audio;
      this.remoteAudio = this.client.sound.context.createMediaStreamSource(
        new MediaStream([audio]),
      );
      this.remoteAudio.connect(this.client.sound.peerGain);
    }
  }
  async sample() {
    const pc = this.pc;
    if (!pc || pc.connectionState !== "connected") return;
    try {
      const stats = await pc.getStats();
      if (pc !== this.pc) return;
      this.syncRemote(pc);
      let frames = 0;
      stats.forEach((report) => {
        if (report.type === "inbound-rtp" && report.kind === "video")
          frames += report.framesDecoded || 0;
      });
      const video = this.remote?.getVideoTracks()[0];
      this.remoteFrames =
        video?.readyState === "live" && !video.muted ? frames : 0;
    } catch {
      /* The connection watchdog handles missing progress. */
    }
  }
  pc: RTCPeerConnection | null = null;
  pcEpoch = -1;
  makingOffer = false;
  ignoreOffer = false;
  pendingCandidates: RTCIceCandidateInit[] = [];
  pendingSignals: Signal[] = [];
  makePeer() {
    if (
      !this.client.state ||
      !this.client.session ||
      !this.client.capture.stream ||
      this.client.state.players.length < 2 ||
      !this.client.state.players.every((p) => p.captureReady) ||
      this.client.sockets.get("control")?.readyState !== WebSocket.OPEN
    )
      return;
    if (this.client.state.mediaMode === "wss") {
      this.reset();
      return;
    }
    if (this.pc && this.pcEpoch === this.client.state.mediaEpoch) return;
    this.reset();
    this.pcEpoch = this.client.state.mediaEpoch;
    this.pendingCandidates = [];
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });
    this.pc = pc;
    this.makingOffer = false;
    this.ignoreOffer = false;
    const current = () =>
      this.pc === pc && this.client.state?.mediaEpoch === this.pcEpoch;
    this.audioSender = pc.addTransceiver("audio", {
      direction: "sendrecv",
      streams: [this.client.capture.stream],
    }).sender;
    this.syncAudio();
    this.client.capture.stream.getVideoTracks().forEach((track) => {
      const sender = pc.addTrack(track, this.client.capture.stream!);
      const params = sender.getParameters();
      params.encodings = [{ maxBitrate: 450000, maxFramerate: 24 }];
      void sender.setParameters(params).catch(() => {});
    });
    for (const data of this.pendingSignals.splice(0)) void this.signal(data);
    pc.onicecandidate = ({ candidate }) => {
      if (current() && candidate)
        this.client.send({
          type: "signal",
          mediaEpoch: this.pcEpoch,
          candidate: candidate.toJSON(),
        });
    };
    pc.ontrack = ({ track }) => {
      if (!current()) return;
      const update = () => {
        if (current()) this.syncRemote(pc);
      };
      track.addEventListener("unmute", update);
      track.addEventListener("ended", update);
      update();
    };
    pc.onconnectionstatechange = () => {
      if (!current()) return;
      this.client.notify({ media: true });
      void this.client.reportHealth();
    };
    pc.onnegotiationneeded = async () => {
      // Give the opening offer to the first seat. Perfect negotiation still
      // handles later changes, without an avoidable initial rollback in Safari.
      if (
        this.client.state?.mediaMode === "connecting" &&
        !pc.remoteDescription &&
        this.client.state.players[1]?.id === this.client.session?.playerId
      )
        return;
      try {
        this.makingOffer = true;
        await pc.setLocalDescription();
        if (!current()) return;
        this.client.send({
          type: "signal",
          mediaEpoch: this.pcEpoch,
          description: pc.localDescription,
        });
      } catch {
      } finally {
        if (current()) this.makingOffer = false;
      }
    };
  }
  async signal(data: Signal) {
    this.makePeer();
    const pc = this.pc;
    if (!pc) {
      if (this.pendingSignals.length < 64) this.pendingSignals.push(data);
      return;
    }
    if (data.mediaEpoch !== this.pcEpoch) return;
    const current = () => this.pc === pc && this.pcEpoch === data.mediaEpoch;
    const polite =
      this.client.state!.players[1]?.id === this.client.session!.playerId;
    try {
      if (data.description) {
        const collision =
          data.description.type === "offer" &&
          (this.makingOffer || pc.signalingState !== "stable");
        this.ignoreOffer = !polite && collision;
        if (this.ignoreOffer) return;
        await pc.setRemoteDescription(data.description);
        if (!current()) return;
        for (const candidate of this.pendingCandidates)
          await pc.addIceCandidate(candidate);
        if (!current()) return;
        this.pendingCandidates = [];
        if (data.description.type === "offer") {
          await pc.setLocalDescription();
          if (!current()) return;
          this.client.send({
            type: "signal",
            mediaEpoch: this.pcEpoch,
            description: pc.localDescription,
          });
        }
      } else if (data.candidate) {
        if (pc.remoteDescription) await pc.addIceCandidate(data.candidate);
        else if (this.pendingCandidates.length < 64)
          this.pendingCandidates.push(data.candidate);
      }
    } catch {
      /* WSS recovery is server selected after the connection deadline. */
    }
  }
}
