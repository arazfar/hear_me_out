import { useEffect, useRef, useState } from "react";
import { points } from "../../shared/domain";
import { client } from "../game/client";
import { ScoreTally } from "../game/feedback";

export function AnimatedScore({
  units,
  reduced,
  roundId,
  playerId,
}: {
  units: number;
  reduced: boolean;
  roundId: string | null;
  playerId?: string;
}) {
  const [display, setDisplay] = useState(units);
  const tally = useRef(new ScoreTally(units));
  const frame = useRef(0),
    quiet = useRef(reduced);
  quiet.current = reduced;
  useEffect(() => {
    tally.current.snap(units);
    setDisplay(units);
    const stop = (target: number) => {
      cancelAnimationFrame(frame.current);
      tally.current.snap(target);
      setDisplay(target);
    };
    const draw = (now: number) => {
      const next = tally.current.value(now);
      setDisplay(next === tally.current.target ? next : Math.floor(next));
      if (next !== tally.current.target)
        frame.current = requestAnimationFrame(draw);
    };
    const unsub = client.on((u) => {
      const target =
        u.state?.players.find((p) => p.id === playerId)?.scoreUnits ??
        tally.current.target;
      if (u.feedbackReset) stop(target);
      if (u.feedback?.kind === "score" && u.feedback.playerId === playerId) {
        if (quiet.current || document.hidden)
          return stop(u.feedback.totalUnits);
        cancelAnimationFrame(frame.current);
        tally.current.aim(u.feedback.totalUnits, performance.now());
        frame.current = requestAnimationFrame(draw);
      } else if (target !== tally.current.target) stop(target);
    });
    return () => {
      unsub();
      cancelAnimationFrame(frame.current);
    };
    // A remounted seat starts at its authoritative value, without replaying cues.
  }, [playerId, roundId]);
  useEffect(() => {
    if (reduced || tally.current.target !== units) {
      cancelAnimationFrame(frame.current);
      tally.current.snap(units);
      setDisplay(units);
    }
  }, [units, reduced]);
  return (
    <span className="score" role="img" aria-label={`${points(units)} points`}>
      <span className="score-numbers" aria-hidden="true">
        {points(display)}
      </span>
      <small aria-hidden="true">Round pts</small>
    </span>
  );
}
