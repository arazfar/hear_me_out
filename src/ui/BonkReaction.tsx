import { useEffect, useState } from "react";
import type { Snapshot } from "../../shared/domain";
import { client } from "../game/client";
import type { FeedbackCue } from "../game/feedback";
export function BonkReaction({ state }: { state: Snapshot }) {
  const [cue, setCue] = useState<Extract<
    FeedbackCue,
    { kind: "reaction" }
  > | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const off = client.on((u) => {
      if (u.feedbackReset) {
        clearTimeout(timer);
        setCue(null);
      }
      if (u.feedback?.kind === "reaction") {
        clearTimeout(timer);
        setCue(u.feedback);
        timer = setTimeout(() => setCue(null), 3200);
      }
    });
    return () => {
      off();
      clearTimeout(timer);
    };
  }, []);
  useEffect(() => {
    if (
      state.phase !== "ROUND" ||
      (state.judge && state.judge.status !== "silent") ||
      (cue && state.turn?.id !== cue.turnId)
    )
      setCue(null);
  }, [state.phase, state.turn?.id, state.judge?.status, cue]);
  const visible =
    cue &&
    state.phase === "ROUND" &&
    state.turn?.id === cue.turnId &&
    (!state.judge || state.judge.status === "silent");
  return (
    <div className="bonk-aside-slot" aria-live="polite" aria-atomic="true">
      {visible && (
        <p key={cue.id} className="bonk-aside">
          <span>
            Bonk · {state.players.find((p) => p.id === cue.playerId)?.name}
          </span>
          {cue.text}
        </p>
      )}
    </div>
  );
}
