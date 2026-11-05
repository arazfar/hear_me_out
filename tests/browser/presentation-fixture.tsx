// Render the production app with deterministic state and mock media for geometry tests.
import { createRoot } from "react-dom/client";
import { App } from "../../src/App";
import { client } from "../../src/game/client";
import {
  snapshotSchema,
  SUGGESTIONS,
  type Snapshot,
} from "../../shared/domain";
import "@fontsource/bungee/400.css";
import "@fontsource/space-grotesk/400.css";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/600.css";
import "@fontsource/space-grotesk/700.css";
import "../../src/style.css";

export type PresentationCase =
  | "invitation"
  | "round-verdict"
  | "aligned-caption"
  | "mic-repair"
  | "camera-repair"
  | "private-check"
  | "manual-retry"
  | "interrupted"
  | "mic-off"
  | "camera-off"
  | "both-off"
  | "missing-device"
  | "notice"
  | "result-help";
declare global {
  interface Window {
    presentation: {
      show: (name: PresentationCase) => void;
      update: (patch: Partial<Snapshot>) => void;
      notice: (message: string) => void;
      leave: () => void;
    };
  }
}
const now = 1800000000000;
const player = (id: string, name: string) => ({
  id,
  name,
  connected: true,
  ready: false,
  mediaReady: true,
  captureReady: true,
  cameraOn: true,
  readiness: { setup: "passed", blockers: [] },
  wins: 0,
  scoreUnits: 24,
});
const initial = snapshotSchema.parse({
  roomId: "presentation-room",
  code: "2048",
  seq: 1,
  phaseVersion: 1,
  phase: "RECOVERING",
  serverNow: now,
  players: [player("alex", "Alex"), player("sam", "Sam")],
  matchId: "match-1",
  headsId: "sam",
  tailsId: "alex",
  topic: {
    ...SUGGESTIONS[0],
    positions: { alex: "Team waffles", sam: "Team pancakes" },
    revision: 1,
    confirmations: [],
  },
  phaseDeadline: null,
  round: 1,
  roundId: "round-1",
  turn: null,
  turnIndex: 0,
  ledger: [],
  claims: [],
  results: [],
  captions: {},
  judge: null,
  mediaMode: "rtc",
  mediaEpoch: 1,
  comebackPlayerId: null,
  rematchReady: [],
  status: "",
  judgePending: false,
  recoveryDeadline: null,
  degraded: { tts: false },
  winnerId: null,
});
const stream = await navigator.mediaDevices.getUserMedia({
  audio: true,
  video: true,
});
client.session = {
  playerId: "alex",
  code: "2048",
  roomId: "presentation-room",
  token: "fixture",
  connectionEpoch: 1,
};
client.restore = async () => {};
client.reportHealth = async () => {};
client.serverNow = () => now;
client.sound.effect = () => {};
client.peer.remote = stream;
const update = (patch: Partial<Snapshot>) => {
  client.state = snapshotSchema.parse({ ...client.state, ...patch });
  client.notify({ state: client.state });
};
const show = (name: PresentationCase) => {
  const state = structuredClone(initial);
  const me = state.players[0];
  me.mediaReady = false;
  me.readiness!.blockers = [name === "camera-repair" ? "camera" : "microphone"];
  client.capture.stream = name === "missing-device" ? null : stream;
  client.capture.micMuted = name === "mic-off" || name === "both-off";
  client.capture.cameraOff = name === "camera-off" || name === "both-off";
  me.cameraOn = !client.capture.cameraOff;
  client.connection.phase = name === "manual-retry" ? "offline" : "connected";
  Object.assign(client.setup, {
    inline: false,
    busy: name === "private-check",
    phase: name === "private-check" ? "testing" : "idle",
    listening: name === "private-check",
    error: "",
  });
  if (name === "private-check") me.readiness!.blockers = ["speech_check"];
  if (name === "interrupted") {
    state.phase = "ABORTED";
    me.mediaReady = true;
    me.readiness!.blockers = [];
    state.status =
      "The match was interrupted because a player could not reconnect.";
  }
  if (name === "invitation") {
    state.phase = "LOBBY";
    state.matchId = null;
    state.roundId = null;
    state.round = 0;
    state.topic = null;
    state.players = [me];
    me.readiness!.blockers = ["peer_video"];
  }
  if (name === "notice" || name === "aligned-caption") {
    state.phase = "ROUND";
    me.mediaReady = true;
    me.readiness!.blockers = [];
    state.turn = {
      id: "turn-1",
      playerId: "alex",
      kind: "case",
      durationMs: 30000,
      remainingMs: 23000,
      deadline: null,
      pausedReason: null,
      sealing: false,
      inputEpoch: 1,
      inputState: "open",
      targets: { reasoning: 20, rebuttal: 0, impact: 12, wit: 6, clarity: 2 },
    };
  }
  if (name === "round-verdict") {
    state.phase = "ROUND_RESOLVE";
    me.mediaReady = true;
    me.readiness!.blockers = [];
    me.wins = 1;
    state.results = [
      {
        round: 1,
        roundId: "round-1",
        winnerId: "alex",
        scores: { alex: 24, sam: 18 },
        reason: "A clear case.",
      },
    ];
  }
  if (name === "aligned-caption") {
    state.judge = {
      id: "opening-line",
      epoch: 1,
      text: "The court has heard your case.",
      status: "captions",
      startAt: null,
      expression: "neutral",
      targetPlayerId: "alex",
    };
  }
  if (name === "result-help") {
    state.phase = "MATCH_RESULT";
    me.name = "Alexandria Catherine";
    me.wins = 2;
    state.players[1].wins = 1;
    state.winnerId = "alex";
    state.results = [
      {
        round: 1,
        roundId: "round-1",
        winnerId: "alex",
        scores: { alex: 24, sam: 18 },
        reason: "A clear case.",
      },
    ];
    state.judge = {
      id: "verdict",
      epoch: 1,
      text:
        "First words. " +
        "The explanation remains fully readable. ".repeat(80) +
        "Last words.",
      status: "captions",
      startAt: null,
      expression: "neutral",
      targetPlayerId: "alex",
    };
  }
  update(state);
  if (name === "notice")
    client.notify({
      error: "Your connection was briefly interrupted. Your turn is safe.",
    });
};
window.presentation = {
  show,
  update,
  notice: (error) => client.notify({ error }),
  leave: () => client.leave(),
};
show("mic-repair");
createRoot(document.getElementById("root")!).render(<App />);
