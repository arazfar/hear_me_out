import assert from "node:assert/strict";
import test from "node:test";
import { Game } from "../server/game/game";
import {
  lobbyPresentation,
  phaseAnnouncement,
  rematchPresentation,
  topicPresentation,
} from "../src/ui/presentation";

const healthy = { message: "" };
function fixture() {
  const game = new Game("1234");
  const a = game.addPlayer("Alex"),
    b = game.addPlayer("Sam");
  a.mediaReady = b.mediaReady = true;
  return { state: game.state, a, b };
}

test("topic decisions identify the chooser and acknowledge either player's confirmation", () => {
  const { state, a, b } = fixture();
  state.phase = "TOPIC_SELECT";
  state.tailsId = b.id;
  assert.equal(phaseAnnouncement(state, a.id, healthy), "Sam is choosing.");
  assert.equal(phaseAnnouncement(state, b.id, healthy), "Choose a topic");
  state.phase = "TOPIC_CONFIRM";
  state.topic = {
    proposition: '"Soup?!" <still soup>',
    positions: { [a.id]: "Yes!!!", [b.id]: "Nope..." },
    revision: 1,
    confirmations: [],
  };
  assert.equal(phaseAnnouncement(state, a.id, healthy), "Confirm your side.");
  state.topic.confirmations.push(a.id);
  assert.equal(
    topicPresentation(state, a.id).waiting,
    "Waiting for Sam to confirm.",
  );
  assert.equal(
    phaseAnnouncement(state, a.id, healthy),
    "Confirmed. Waiting for Sam to confirm.",
  );
  assert.equal(
    phaseAnnouncement(state, b.id, healthy),
    "Alex confirmed. Confirm your side.",
  );
  state.topic.confirmations.push(b.id);
  assert.equal(topicPresentation(state, a.id).waiting, "");
  assert.equal(
    phaseAnnouncement(state, a.id, healthy),
    "Both sides confirmed.",
  );
  assert.equal(state.topic.proposition, '"Soup?!" <still soup>');
});

test("lobby announcements track readiness decisions and undo without changing actions", () => {
  const { state, a, b } = fixture();
  assert.equal(lobbyPresentation(state, a.id).actionLabel, "Ready to argue");
  a.ready = true;
  assert.equal(lobbyPresentation(state, a.id).actionLabel, "Ready · undo");
  assert.equal(
    phaseAnnouncement(state, a.id, healthy),
    "Ready. Waiting for Sam.",
  );
  assert.equal(
    phaseAnnouncement(state, b.id, healthy),
    "Alex is ready. Ready to argue.",
  );
  a.ready = false;
  assert.equal(phaseAnnouncement(state, b.id, healthy), "Ready to argue");
  state.players = [a];
  assert.equal(phaseAnnouncement(state, a.id, healthy), "Invite your friend");
});

test("queued rematches never blame a ready or blocked friend for the delay", () => {
  const { state, a, b } = fixture();
  for (const phase of ["MATCH_RESULT", "ABORTED"] as const) {
    state.phase = phase;
    state.rematchReady = [];
    assert.equal(
      rematchPresentation(state, a.id, healthy).actionLabel,
      phase === "ABORTED" ? "Try a fresh match" : "Rematch",
    );
    state.rematchReady = [a.id];
    assert.equal(
      rematchPresentation(state, a.id, healthy).actionLabel,
      "Waiting for Sam",
    );
    assert.equal(
      phaseAnnouncement(state, b.id, healthy),
      "Alex is ready for a rematch.",
    );
    for (const status of [
      "buffering",
      "speaking",
      "captions",
      "silent",
    ] as const) {
      state.judge = {
        id: "verdict",
        epoch: 1,
        text: "Case closed.",
        status,
        expression: "smug",
        targetPlayerId: null,
        startAt: null,
      };
      state.rematchReady = [a.id, b.id];
      assert.equal(
        rematchPresentation(state, a.id, healthy).actionLabel,
        "Rematch queued",
      );
      assert.equal(
        phaseAnnouncement(state, a.id, healthy),
        "Both ready. Rematch queued.",
      );
    }
    state.rematchReady = [a.id];
    b.mediaReady = false;
    const blocked = { message: "Waiting for Sam’s mic." };
    assert.equal(
      rematchPresentation(state, a.id, blocked).actionLabel,
      "Rematch queued",
    );
    assert.equal(phaseAnnouncement(state, a.id, blocked), blocked.message);
    b.mediaReady = true;
  }
});

test("recovery and departure override decisions; clock-only snapshots keep announcements stable", () => {
  const { state, a, b } = fixture();
  state.phase = "MATCH_RESULT";
  state.rematchReady = [a.id, b.id];
  const previous = phaseAnnouncement(state, a.id, healthy);
  const repeated = structuredClone(state);
  repeated.seq++;
  repeated.serverNow += 1000;
  repeated.phaseDeadline = 5000;
  assert.equal(phaseAnnouncement(repeated, a.id, healthy), previous);
  const reconnecting = { message: "Reconnecting…" };
  assert.equal(
    phaseAnnouncement(state, a.id, reconnecting, { reconnecting: true }),
    reconnecting.message,
  );
  a.mediaReady = false;
  assert.equal(
    phaseAnnouncement(state, a.id, { message: "Mic off." }),
    "Mic off.",
  );
  b.connected = false;
  assert.equal(
    phaseAnnouncement(state, a.id, reconnecting),
    "Match complete. Your friend isn’t here.",
  );
  state.phase = "ABORTED";
  state.players = [a];
  state.status = "Sam left the court. No winner this time.";
  assert.equal(phaseAnnouncement(state, a.id, reconnecting), state.status);
});
