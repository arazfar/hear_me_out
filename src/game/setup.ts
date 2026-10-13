import type { Client } from "./client";
import type { ServerMessage } from "../../shared/protocol";

export class DeviceSetup {
  constructor(readonly client: Client) {}
  inline = false;
  busy = false;
  listening = false;
  phase:
    | "idle"
    | "permissions"
    | "connecting"
    | "testing"
    | "ready"
    | "error"
    | "privacy" = "idle";
  text = "";
  heardAt = 0;
  error = "";
  checkId = "";
  commandId: string | undefined;
  repair: "camera" | undefined;
  abort: AbortController | null = null;
  connectionInterrupted() {
    if (!this.busy || !this.checkId || this.phase === "ready") return;
    this.listening = false;
    this.phase = "connecting";
    this.update();
  }
  reconnected() {
    if (!this.busy || !this.checkId || this.client.reconnecting) return;
    this.commandId = this.client.command({
      type: "setup_start",
      checkId: this.checkId,
      captureId: this.client.capture.captureId,
    });
  }
  private pauseForPrivacy() {
    this.abort?.abort();
    this.abort = null;
    this.client.command({ type: "setup_cancel", checkId: this.checkId });
    this.checkId = "";
    this.commandId = undefined;
    this.busy = this.listening = false;
    this.error = this.text = "";
    this.phase = "privacy";
    this.repair = undefined;
    this.update();
  }
  privacyChanged() {
    if (this.client.capture.micMuted || this.client.capture.cameraOff) {
      // Acquisition may still commit useful capture. Only its subsequent
      // private check is suspended by a privacy choice.
      if (this.busy && this.phase !== "permissions") this.pauseForPrivacy();
    } else if (this.phase === "privacy") {
      void this.run();
    }
  }
  private update() {
    this.client.capture.syncMicrophone();
    this.client.notify({ media: true });
  }
  private wait(
    test: () => boolean,
    ms: number,
    message: string,
    signal: AbortSignal,
  ) {
    return new Promise<void>((resolve, reject) => {
      let off = () => {};
      const finish = (error?: Error) => {
        off();
        clearTimeout(timer);
        signal.removeEventListener("abort", cancel);
        error ? reject(error) : resolve();
      };
      const cancel = () => finish(new Error("Setup cancelled."));
      const timer = setTimeout(() => finish(new Error(message)), ms);
      off = this.client.on(() => {
        if (this.error) finish(new Error(this.error));
        else if (test()) finish();
      });
      signal.addEventListener("abort", cancel, { once: true });
      if (signal.aborted) cancel();
      else if (test()) finish();
    });
  }
  async run(repair?: "camera") {
    if (this.busy) return;
    this.repair = repair;
    const attempt = (this.abort = new AbortController());
    this.busy = true;
    this.error = "";
    this.text = "";
    this.checkId = "";
    this.commandId = undefined;
    this.phase = "permissions";
    this.update();
    try {
      await this.client.capture.devices(repair, attempt.signal);
      if (attempt.signal.aborted) return;
      if (this.client.capture.micMuted || this.client.capture.cameraOff) {
        this.pauseForPrivacy();
        return;
      }
      this.phase = "connecting";
      this.update();
      await this.wait(
        () => this.client.connection.phase === "connected",
        10000,
        "Couldn’t connect to court. Try again.",
        attempt.signal,
      );
      await this.client.reportHealth();
      await this.wait(
        () =>
          !!this.client.state?.players.find(
            (p) => p.id === this.client.session?.playerId,
          )?.captureReady,
        10000,
        "Your camera or mic stopped. Reconnect it and retry.",
        attempt.signal,
      );
      const me = () =>
        this.client.state?.players.find(
          (p) => p.id === this.client.session?.playerId,
        );
      if (me()?.readiness?.setup !== "passed") {
        this.checkId = crypto.randomUUID();
        this.phase = "testing";
        this.commandId = this.client.command({
          type: "setup_start",
          checkId: this.checkId,
          captureId: this.client.capture.captureId,
        });
        this.update();
        await this.wait(
          () => this.phase === "ready",
          26000,
          "No words came through. Try the mic check again.",
          attempt.signal,
        );
      }
      await this.wait(
        () =>
          !me()?.readiness?.blockers.some((b) => !["peer_video"].includes(b)),
        10000,
        "Your camera isn’t getting through. Try again.",
        attempt.signal,
      );
      this.phase = "ready";
      this.listening = false;
      this.inline = false;
    } catch (error) {
      if (attempt.signal.aborted) return;
      this.error =
        error instanceof Error
          ? error.message
          : "Couldn’t finish setup. Try again.";
      this.phase = "error";
      this.client.command({ type: "setup_cancel", checkId: this.checkId });
    } finally {
      if (this.abort === attempt) {
        this.busy = false;
        this.listening = false;
        this.update();
      }
    }
  }
  result(data: Extract<ServerMessage, { type: "setup_result" }>) {
    if (data.checkId !== this.checkId || !this.busy) return;
    if (data.status === "listening") {
      if (this.phase === "ready") return;
      this.phase = "testing";
      this.listening = true;
    }
    if (data.status === "passed") {
      this.phase = "ready";
      this.text = data.text;
      this.heardAt = Date.now();
      this.listening = false;
    }
    if (data.status === "failed") {
      this.error = data.text;
      this.phase = "error";
      this.listening = false;
    }
    this.update();
  }
  cancel() {
    this.abort?.abort();
    this.abort = null;
    this.client.sound.cancelInitialization();
    this.client.command({ type: "setup_cancel", checkId: this.checkId });
    this.checkId = "";
    this.commandId = undefined;
    this.busy = this.listening = this.inline = false;
    this.phase = "idle";
    this.error = this.text = "";
    this.repair = undefined;
  }
}
