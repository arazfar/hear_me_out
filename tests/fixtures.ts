import { Game } from "../server/game/game";
import { PreparedVoice } from "../server/judge/voice-cache";
import { RoomController, type Seat } from "../server/rooms/room";
import { AudioBudget } from "../server/transport/audio-budget";
import type {
  RoomServices,
  TranscriptionStream,
} from "../server/rooms/services";
import type { Segment } from "../shared/domain";

export function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
export const flush = () =>
  new Promise<void>((resolve) => setImmediate(resolve));
export const fakeVoice: RoomServices["streamVoice"] = async (
  _text,
  onChunk,
  cancelled,
) => {
  if (!cancelled())
    onChunk(new Uint8Array(new Int16Array(15876).fill(3276).buffer));
  return 0.36;
};
export function services(
  overrides: Partial<RoomServices> = {},
): Partial<RoomServices> {
  return {
    warmVoice: () => {},
    transcriptionAvailable: () => false,
    streamVoice: fakeVoice,
    fixedVoice: () => undefined,
    prepareVoice: (text, seconds) =>
      new PreparedVoice(text, seconds, fakeVoice),
    ...overrides,
  };
}
export function seat(): Seat {
  return {
    tokenHash: "fixture",
    epoch: 1,
    sockets: new Map(),
    audioSeq: -1,
    audioBudget: new AudioBudget(),
    lastAudioAt: 0,
    voiceAt: 0,
    lastActivity: 0,
    rtcReady: false,
    acks: new Map(),
  };
}
export function startRound(game: Game) {
  if (!game.state.players.length) {
    game.addPlayer("Sam");
    game.addPlayer("Alex");
  }
  game.state.players.forEach((p) => (p.mediaReady = true));
  game.startMatch();
  game.selectTopic();
  game.proposeTopic(
    game.state.tailsId!,
    "Waffles are better.",
    "Waffles",
    "Pancakes",
    true,
  );
  game.state.players.forEach((p) => game.confirm(p.id, 1));
  return game.state.turn!;
}
export function roomFixture(overrides: Partial<RoomServices> = {}) {
  const room = new RoomController("1234", services(overrides));
  const turn = startRound(room.game);
  room.playback.cancelSpeech();
  room.playback.pendingHandoff = null;
  room.playback.hostCues = [];
  room.game.state.players.forEach((p) => room.seats.set(p.id, seat()));
  room.game.grantInput(1);
  room.game.openInput(1, room.services.now());
  return { room, turn };
}
export function evidence(game: Game, id = "segment"): Segment {
  return {
    id,
    playerId: game.state.turn!.playerId,
    roundId: game.state.roundId!,
    turnId: game.state.turn!.id,
    sessionEpoch: "fixture",
    text: "Waffle pockets distribute syrup across every bite.",
    stableAt: game.now(),
    eligible: true,
    source: "voice",
  };
}
export function fakeTranscription(
  turnId: string | null,
  roundId: string,
  send: (audio: Buffer) => void = () => {},
): TranscriptionStream {
  return {
    turnId,
    roundId,
    connected: true,
    closing: false,
    failed: false,
    send,
    close: async () => true,
  };
}

export function fakeSpeech(
  room: RoomController,
  overrides: Partial<NonNullable<RoomController["playback"]["speech"]>> = {},
) {
  return {
    id: "speech",
    epoch: 1,
    text: "Bonk is speaking.",
    target: null,
    ready: new Set<string>(),
    completed: new Set<string>(),
    connections: new Map<string, number>(),
    progress: new Map<string, { samples: number; at: number }>(),
    rtt: 0,
    duration: 1,
    samples: 44100,
    startedAt: null,
    done: false,
    timer: null,
    began: room.services.now(),
    generatedAt: room.services.now(),
    frames: [],
    sent: 0,
    eofSent: false,
    carry: new Uint8Array(),
    turnId: null,
    matchId: room.game.state.matchId,
    attempt: 0,
    fallback: false,
    ...overrides,
  };
}
