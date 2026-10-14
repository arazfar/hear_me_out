/** Server time advances with a monotonic clock, never the laptop's wall clock. */
export class ServerClock {
  private anchor = 0;
  private observedAt = 0;
  synced = false;
  rttMs = 0;
  constructor(private readonly monotonic = () => performance.now()) {}
  observe(serverNow: number, roundTripMs = 0) {
    if (!Number.isFinite(serverNow) || !Number.isFinite(roundTripMs)) return;
    this.rttMs = Math.max(0, Math.min(roundTripMs, 2000));
    this.observedAt = this.monotonic();
    this.anchor = serverNow + Math.max(0, Math.min(roundTripMs, 2000)) / 2;
    this.synced = true;
  }
  now() {
    return this.anchor + this.monotonic() - this.observedAt;
  }
  reset() {
    this.synced = false;
  }
}
