export const PHRASES = {
  welcome: ["Welcome to questionable opinions, confidently delivered.", "Welcome to the court of spectacular nonsense.", "Good evening, esteemed experts in absolutely nothing."],
  coin: ["Let fate take the blame!", "One coin. Two egos. Excellent odds.", "Heads or tails. Dignity loses either way."],
  topic: ["Choose your hill. Defend it irresponsibly.", "Pick a fight worthy of these tiny podiums.", "Choose the controversy your group chat deserves."],
  nudge: ["The suspense is delicious. Pick your disaster.", "Any hill will do. Bring a shovel.", "We need a topic, not a doctoral thesis."],
  round: ["New round. Same hill. Sharper shovels.", "Round reset. Opinions remain on probation.", "Fresh points. Bring better nonsense."],
} as const;
export const FIXED_LINES = Object.values(PHRASES).flat();
export class HostPhrases {
  used = new Set<string>();
  pick(kind: keyof typeof PHRASES) {
    const line = PHRASES[kind].find(text => !this.used.has(text)) || PHRASES[kind][0];
    this.used.add(line);
    return line;
  }
  reset() { this.used.clear(); }
}
export function safeReaction(text: string): string | null {
  const clean = text.replace(/[\p{Cc}\p{Cf}]/gu, "").replace(/\s+/g, " ").trim();
  if (!clean || clean.length > 100 || clean.split(/\s+/).length > 8 || /\[[^\]]*\]/.test(clean)) return null;
  return clean;
}
export const voiceSettingsKey = () => `${process.env.FISH_VOICE_ID || "29f4e37195264ebc86cf568ea6e36aff"}:${process.env.FISH_TTS_MODEL || "s2-pro"}:1.2:4:excited`;
