import {
  PreparedVoice,
  fixedVoice,
  warmHostVoice,
} from "../judge/voice-cache.js";
import { InkSession, judge, streamVoice } from "../providers/index.js";
export type TranscriptionStream = Pick<
  InkSession,
  "turnId" | "roundId" | "connected" | "closing" | "failed" | "send" | "close"
>;
export interface RoomServices {
  now: () => number;
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
  judge: typeof judge;
  createTranscription: (
    ...args: ConstructorParameters<typeof InkSession>
  ) => TranscriptionStream;
  streamVoice: typeof streamVoice;
  prepareVoice: (text: string, seconds?: number) => PreparedVoice;
  fixedVoice: typeof fixedVoice;
  warmVoice: () => void;
  transcriptionAvailable: () => boolean;
}
export const defaultServices: RoomServices = {
  now: Date.now,
  setTimeout,
  clearTimeout,
  judge,
  streamVoice,
  createTranscription: (...args) => new InkSession(...args),
  prepareVoice: (text, seconds) => new PreparedVoice(text, seconds),
  fixedVoice,
  warmVoice: warmHostVoice,
  transcriptionAvailable: () => !!process.env.CARTESIA_API_KEY,
};
