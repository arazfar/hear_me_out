import { type Signal } from "../../shared/protocol";
import type { Client } from "../game/client";
export class PeerMedia {
  constructor(readonly client: Client) {}
  remote: MediaStream | null = null;
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
      this.pc?.close();
      this.pc = null;
      this.remote = null;
      return;
    }
    if (this.pc && this.pcEpoch === this.client.state.mediaEpoch) return;
    this.pc?.close();
    this.pcEpoch = this.client.state.mediaEpoch;
    this.pendingCandidates = [];
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });
    this.pc = pc;
    this.client.capture.stream.getTracks().forEach((track) => {
      const sender = pc.addTrack(track, this.client.capture.stream!);
      if (track.kind === "video") {
        const params = sender.getParameters();
        params.encodings = [{ maxBitrate: 450000, maxFramerate: 24 }];
        void sender.setParameters(params).catch(() => {});
      }
    });
    for (const data of this.pendingSignals.splice(0)) void this.signal(data);
    pc.onicecandidate = ({ candidate }) => {
      if (candidate)
        this.client.send({
          type: "signal",
          mediaEpoch: this.pcEpoch,
          candidate: candidate.toJSON(),
        });
    };
    pc.ontrack = ({ streams, track }) => {
      this.remote = streams[0] || new MediaStream([track]);
      this.client.notify({ media: true });
    };
    pc.onconnectionstatechange = () => {
      this.client.notify({ media: true });
      this.client.command({
        type: "media_status",
        ready: true,
        cameraOn: !this.client.capture.cameraOff,
        rtc: pc.connectionState === "connected",
      });
    };
    pc.onnegotiationneeded = async () => {
      try {
        this.makingOffer = true;
        await pc.setLocalDescription();
        this.client.send({
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
  async signal(data: Signal) {
    this.makePeer();
    const pc = this.pc;
    if (!pc) {
      if (this.pendingSignals.length < 64) this.pendingSignals.push(data);
      return;
    }
    if (data.mediaEpoch !== this.pcEpoch) return;
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
        for (const candidate of this.pendingCandidates)
          await pc.addIceCandidate(candidate);
        this.pendingCandidates = [];
        if (data.description.type === "offer") {
          await pc.setLocalDescription();
          this.client.send({
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
}
