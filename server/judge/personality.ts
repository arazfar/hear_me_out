export const PHRASES = {
  welcome: [
    "Court is open. Let’s hear those opinions.",
    "Welcome! I trust you brought a terrible take.",
    "The court of bad takes is in session.",
  ],
  coin: [
    "Let fate take the blame!",
    "Let’s see who gets the first word.",
    "Heads goes first. Tails picks the topic.",
  ],
  topic: [
    "What are we arguing about?",
    "Pick a fight worthy of these tiny podiums.",
    "Pick something you’d argue about over dinner.",
  ],
  nudge: [
    "Anything you two disagree about?",
    "The breakfast arguments are always good.",
    "Pick a topic so we can get started.",
  ],
  round: [
    "Next round. Who’s changing my mind?",
    "Points reset. Let’s hear your next case.",
    "New round. I’m listening.",
  ],
} as const;
export const FIXED_LINES = Object.values(PHRASES).flat();
export class HostPhrases {
  used = new Set<string>();
  pick(kind: keyof typeof PHRASES) {
    const line =
      PHRASES[kind].find((text) => !this.used.has(text)) || PHRASES[kind][0];
    this.used.add(line);
    return line;
  }
  reset() {
    this.used.clear();
  }
}
export function safeReaction(text: string): string | null {
  const clean = text
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  if (
    !clean ||
    clean.length > 100 ||
    clean.split(/\s+/).length > 8 ||
    /\[[^\]]*\]/.test(clean)
  )
    return null;
  return clean;
}
export const voiceSettingsKey = () =>
  `${process.env.FISH_VOICE_ID || "29f4e37195264ebc86cf568ea6e36aff"}:${process.env.FISH_TTS_MODEL || "s2-pro"}:1.2:4:excited`;

/** Omit optional sentences; never splice a sentence or synthesize partial copy. */
export function completeSpeech(text: string, maxWords = 42): string {
  const clean = text
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const sentences = clean.match(/[^.!?]+[.!?]+(?:[”’"']|$)?/g) || [];
  let result = "";
  for (const sentence of sentences) {
    const next = `${result} ${sentence.trim()}`.trim();
    if (next.split(/\s+/).length > maxWords) break;
    result = next;
  }
  return result || "Court is in session.";
}
