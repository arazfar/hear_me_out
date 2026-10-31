import assert from "node:assert/strict";
import test from "node:test";
import { Game } from "../server/game/game";
import { playerAtSeat, playerColor, playerSeat } from "../src/ui/identity";

test("server seats survive departure, replacement, reconnect and a new match", () => {
  const game = new Game("1234", () => {});
  const a = game.addPlayer("Alex"),
    b = game.addPlayer("Sam");
  assert.equal(a.seat, 0);
  assert.equal(b.seat, 1);
  game.removePlayer(a.id);
  assert.equal(playerAtSeat(game.state, 0), undefined);
  assert.equal(playerAtSeat(game.state, 1)?.id, b.id);
  assert.equal(playerColor(game.state, b.id), "var(--identity-seat1-base)");
  const c = game.addPlayer("Taylor");
  assert.equal(c.seat, 0);
  assert.equal(playerAtSeat(game.state, 0)?.id, c.id);
  game.disconnectPlayer(b.id);
  game.resumePlayer(b.id);
  assert.equal(playerSeat(game.state, b), 1);
  for (const p of game.state.players) p.mediaReady = true;
  game.ready(b.id, true);
  game.ready(c.id, true);
  assert.equal(
    playerColor(game.snapshot(), b.id),
    "var(--identity-seat1-base)",
  );
  assert.equal(
    playerColor(game.snapshot(), c.id),
    "var(--identity-seat0-base)",
  );
});

test("identity follows each winner, not client perspective or result order", () => {
  const game = new Game("1234", () => {});
  const a = game.addPlayer("Alex"),
    b = game.addPlayer("Sam");
  for (const winner of [a, b]) {
    game.state.winnerId = winner.id;
    const viewA = game.snapshot(),
      viewB = game.snapshot();
    viewB.players.reverse();
    assert.equal(
      playerColor(viewA, viewA.winnerId),
      playerColor(viewB, viewB.winnerId),
    );
    assert.equal(
      playerAtSeat(viewA, winner.seat!)?.id,
      playerAtSeat(viewB, winner.seat!)?.id,
    );
  }
  assert.equal(playerColor(game.state, "missing"), "var(--action-primary)");
});

test("legacy player snapshots retain their ordered seat mapping", () => {
  const game = new Game("1234", () => {});
  const a = game.addPlayer("Alex"),
    b = game.addPlayer("Sam");
  delete a.seat;
  delete b.seat;
  assert.equal(playerSeat(game.state, a), 0);
  assert.equal(playerSeat(game.state, b), 1);
});
