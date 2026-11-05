/** Samples actually processed by the worklet, read at the device's output time. */
export class CaptionClock {
  private marks: { samples: number; time: number }[] = [];
  reset() {
    this.marks = [];
  }
  record(samples: number, time: number) {
    if (!Number.isFinite(samples) || samples < 0 || !Number.isFinite(time))
      return;
    const last = this.marks.at(-1);
    if (last && (time < last.time || samples < last.samples)) return;
    this.marks.push({ samples, time });
    if (this.marks.length > 128) this.marks.shift();
  }
  at(time: number) {
    let previous = { samples: 0, time: -Infinity };
    for (const mark of this.marks) {
      if (mark.time > time) {
        if (!Number.isFinite(previous.time) || mark.time === previous.time)
          return previous.samples;
        return Math.floor(
          previous.samples +
            ((mark.samples - previous.samples) * (time - previous.time)) /
              (mark.time - previous.time),
        );
      }
      previous = mark;
    }
    // Never extrapolate into audio that has not been rendered.
    return previous.samples;
  }
}
