import type { CaptionCue } from "../../shared/domain";

/** Group actual alignment segments; never invent timing within a segment. */
export function spokenPhrase(cues: CaptionCue[], samples: number) {
  let active = cues.length - 1;
  while (active >= 0 && samples < cues[active].start) active--;
  if (active < 0) return null;
  let start = 0;
  for (let i = 0, length = 0; i <= active; i++) {
    if (length && length + cues[i].text.length + 1 > 52) {
      start = i;
      length = 0;
    }
    length += cues[i].text.length + 1;
  }
  // Reveal only words that have actually begun, keeping earlier words as context.
  return {
    cues: cues.slice(start, active + 1),
    active: samples < cues[active].end ? active - start : -1,
  };
}
export function latestPhrase(text: string) {
  const words = text.trim().split(/\s+/);
  let start = words.length - 1,
    length = words[start]?.length || 0;
  while (start > 0 && length + words[start - 1].length + 1 <= 52)
    length += words[--start].length + 1;
  return words.slice(start).join(" ");
}
