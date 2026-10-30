import type { Player, Snapshot } from "../../shared/domain";

export type Seat = 0 | 1;
/** Explicit seats survive array compaction; old snapshots keep their original order. */
export function playerSeat(
  state: Pick<Snapshot, "players">,
  player?: Player,
): Seat | undefined {
  if (!player) return undefined;
  return (
    player.seat ??
    (state.players.findIndex((p) => p.id === player.id) === 1 ? 1 : 0)
  );
}
export function playerAtSeat(state: Pick<Snapshot, "players">, seat: Seat) {
  return state.players.find((p) => playerSeat(state, p) === seat);
}
export function playerColor(
  state: Pick<Snapshot, "players">,
  id?: string | null,
) {
  const seat = playerSeat(
    state,
    state.players.find((p) => p.id === id),
  );
  return seat === undefined ? "var(--brass)" : `var(--seat${seat})`;
}
