/** One seat owns its budget across socket replacement and connection epochs. */
export class AudioBudget {
  private messages = 200;
  private bytes = 128 * 1024;
  private at: number | null = null;
  admit(bytes: number, now: number): "messages" | "bytes" | null {
    const elapsed = Math.max(0, now - (this.at ?? now)) / 1000;
    this.at = Math.max(this.at ?? now, now);
    this.messages = Math.min(200, this.messages + elapsed * 100);
    this.bytes = Math.min(128 * 1024, this.bytes + elapsed * 40 * 1024);
    const reason =
      this.messages < 1 ? "messages" : this.bytes < bytes ? "bytes" : null;
    if (reason) return reason;
    this.messages--;
    this.bytes -= bytes;
    return null;
  }
}
