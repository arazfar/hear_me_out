import { snapshotSchema, type Snapshot } from "../../shared/domain";
import { sessionSchema, type Session } from "../../shared/protocol";
import type { Client } from "./client";
import { z } from "zod";

const savedSeatSchema = sessionSchema.extend({ resumeId: z.uuid().optional() });
type PendingResume = Session & { resumeId: string };

type Attempt = {
  controller: AbortController;
  authenticated: boolean;
  deadline: number;
  timeout?: ReturnType<typeof setTimeout>;
  ready?: () => void;
};
type Recovery = {
  controller: AbortController;
  deadline: number;
  attempt?: Attempt;
  promise: Promise<boolean>;
};
class ExpiredSeat extends Error {}

/** Race even non-abortable work, while its continuation still checks ownership. */
function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const cancel = () => reject(signal.reason);
    if (signal.aborted) cancel();
    else signal.addEventListener("abort", cancel, { once: true });
    work
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", cancel));
  });
}
function delay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const cancel = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", cancel);
      resolve();
    }, ms);
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) cancel();
  });
}

/** One bounded recovery owns HTTP, handshake, backoff, and cancellation. */
export class Connection {
  phase: "idle" | "connecting" | "connected" | "offline" = "idle";
  private recovery: Recovery | null = null;
  private pendingResume: PendingResume | null = null;
  constructor(readonly client: Client) {}
  restore(saved: string) {
    const record = savedSeatSchema.parse(JSON.parse(saved));
    const session = sessionSchema.parse(record);
    this.pendingResume = record.resumeId
      ? { ...session, resumeId: record.resumeId }
      : null;
    return this.open(session);
  }
  departure() {
    return this.pendingResume ?? this.client.session;
  }
  private resumeRequest(session: Session) {
    if (!this.pendingResume) {
      const request = { ...session, resumeId: crypto.randomUUID() };
      // Persist before sending: reload and Leave must identify a transition
      // even when the server accepted it but its response never arrived.
      sessionStorage.setItem("hmo-seat", JSON.stringify(request));
      this.pendingResume = request;
    }
    return this.pendingResume;
  }
  get blocked() {
    return this.phase === "connecting" || this.phase === "offline";
  }
  private publish(phase: Connection["phase"]) {
    this.phase = phase;
    if (phase !== "connected") this.client.setup.connectionInterrupted();
    this.client.capture.syncMicrophone();
    this.client.notify({
      connection: phase === "connecting" ? "reconnecting" : phase,
    });
  }
  cancel() {
    const recovery = this.recovery;
    this.recovery = null;
    this.pendingResume = null;
    recovery?.controller.abort(new Error("Connection cancelled."));
    recovery?.attempt?.controller.abort(new Error("Connection cancelled."));
    this.phase = "idle";
  }
  progress(authenticated = false) {
    const attempt = this.recovery?.attempt;
    if (!attempt || attempt.controller.signal.aborted) return;
    attempt.authenticated ||= authenticated;
    if (
      attempt.authenticated &&
      this.client.clock.synced &&
      ["control", "audio", "video"].every(
        (channel) =>
          this.client.sockets.get(channel)?.readyState === WebSocket.OPEN,
      )
    )
      attempt.ready?.();
  }
  private armDeadline(recovery: Recovery, attempt: Attempt) {
    clearTimeout(attempt.timeout);
    attempt.timeout = setTimeout(
      () => attempt.controller.abort(new Error("Connection timed out.")),
      Math.max(
        0,
        Math.min(recovery.deadline, attempt.deadline) - performance.now(),
      ),
    );
  }
  observe(snapshot: Snapshot) {
    const recovery = this.recovery;
    if (
      !recovery ||
      snapshot.phase !== "RECOVERING" ||
      snapshot.recoveryDeadline === null
    )
      return;
    recovery.deadline = Math.min(
      recovery.deadline,
      performance.now() +
        Math.max(0, snapshot.recoveryDeadline - snapshot.serverNow),
    );
    if (recovery.attempt) this.armDeadline(recovery, recovery.attempt);
  }
  lost() {
    if (this.recovery) {
      this.recovery.attempt?.controller.abort(
        new Error("Connection interrupted."),
      );
    } else if (this.client.session && this.phase !== "offline") {
      void this.open(this.client.session, undefined, 1000);
    }
  }
  open(
    session: Session,
    snapshot?: Snapshot,
    firstDelay = 0,
    manual = false,
  ): Promise<boolean> {
    if (this.recovery) return this.recovery.promise;
    const knownDeadline =
      this.client.state?.phase === "RECOVERING"
        ? this.client.state.recoveryDeadline
        : null;
    const remaining =
      knownDeadline === null || knownDeadline === undefined
        ? 60000
        : Math.max(0, knownDeadline - this.client.serverNow());
    // A manual retry can fetch the server's final state after its allowance ends.
    const budget =
      manual && remaining === 0 ? 10000 : Math.min(60000, remaining);
    const recovery: Recovery = {
      controller: new AbortController(),
      deadline: performance.now() + budget,
      promise: Promise.resolve(false),
    };
    this.recovery = recovery;
    this.client.session = session;
    this.publish("connecting");
    this.client.playback.stopJudge();
    this.client.closeTransport();
    recovery.promise = this.run(recovery, snapshot, firstDelay);
    return recovery.promise;
  }
  private async run(
    recovery: Recovery,
    snapshot: Snapshot | undefined,
    firstDelay: number,
  ) {
    const current = () =>
      this.recovery === recovery && !recovery.controller.signal.aborted;
    let backoff = firstDelay;
    while (current() && performance.now() < recovery.deadline) {
      try {
        if (backoff)
          await delay(
            Math.min(backoff, recovery.deadline - performance.now()),
            recovery.controller.signal,
          );
        if (!current() || performance.now() >= recovery.deadline) break;
        const attempt: Attempt = {
          controller: new AbortController(),
          authenticated: false,
          deadline: performance.now() + 10000,
        };
        recovery.attempt = attempt;
        this.armDeadline(recovery, attempt);
        const cancel = () =>
          attempt.controller.abort(recovery.controller.signal.reason);
        recovery.controller.signal.addEventListener("abort", cancel, {
          once: true,
        });
        const signal = attempt.controller.signal;
        const initial = snapshot;
        snapshot = undefined;
        try {
          await abortable(
            (async () => {
              let session = this.client.session!,
                next = initial;
              if (!next) {
                const response = await fetch("/api/resume", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(this.resumeRequest(session)),
                  signal,
                });
                const body = await response.json();
                signal.throwIfAborted();
                if (response.status === 401 || response.status === 409)
                  throw new ExpiredSeat(
                    body.error || "Your seat expired. Join a new court.",
                  );
                if (!response.ok)
                  throw new Error(body.error || "Couldn’t reconnect.");
                session = sessionSchema.parse(body.session);
                next = snapshotSchema.parse(body.snapshot);
              }
              signal.throwIfAborted();
              if (!current()) throw new Error("Connection replaced.");
              sessionStorage.setItem("hmo-seat", JSON.stringify(session));
              this.pendingResume = null;
              // Register before attach: fast authentication must not be missed.
              const handshake = new Promise<void>((resolve) => {
                attempt.ready = resolve;
              });
              this.observe(next);
              this.client.attach(session, next);
              this.progress();
              await abortable(handshake, signal);
            })(),
            signal,
          );
          if (!current() || signal.aborted) return false;
          this.recovery = null;
          this.publish("connected");
          const epoch = this.client.session?.connectionEpoch;
          void this.client.reportHealth().then(() => {
            if (
              this.phase === "connected" &&
              this.client.session?.connectionEpoch === epoch
            )
              this.client.setup.reconnected();
          });
          return true;
        } finally {
          clearTimeout(attempt.timeout);
          recovery.controller.signal.removeEventListener("abort", cancel);
          attempt.controller.abort(new Error("Attempt finished."));
          if (recovery.attempt === attempt) recovery.attempt = undefined;
        }
      } catch (error) {
        if (!current()) return false;
        this.client.closeTransport();
        if (error instanceof ExpiredSeat) {
          this.client.leave();
          this.client.notify({ error: error.message });
          return false;
        }
      }
      backoff = backoff ? Math.min(4000, backoff * 2) : 1000;
    }
    if (current()) {
      this.recovery = null;
      this.client.closeTransport();
      this.publish("offline");
    }
    return false;
  }
}
