import { useEffect, useRef, useState } from "react";
import { points } from "../../shared/domain";
export function AnimatedScore({
  units,
  reduced,
  roundId,
}: {
  units: number;
  reduced: boolean;
  roundId: string | null;
}) {
  const [display, setDisplay] = useState(units);
  const displayRef = useRef(units);
  const previousRound = useRef(roundId);
  useEffect(() => {
    if (
      reduced ||
      units <= displayRef.current ||
      previousRound.current !== roundId
    ) {
      previousRound.current = roundId;
      displayRef.current = units;
      setDisplay(units);
      return;
    }
    const from = displayRef.current,
      began = performance.now();
    let frame = 0;
    const tally = (now: number) => {
      const t = Math.max(0, Math.min(1, (now - began) / 480));
      const next = Math.min(
        units,
        Math.floor(from + (units - from) * (1 - (1 - t) ** 3)),
      );
      displayRef.current = next;
      setDisplay(next);
      if (t < 1) frame = requestAnimationFrame(tally);
    };
    frame = requestAnimationFrame(tally);
    return () => cancelAnimationFrame(frame);
  }, [units, reduced, roundId]);
  return (
    <span
      className={`score ${display !== units ? "tallying" : ""}`}
      aria-label={`${points(units)} points`}
    >
      <span className="score-numbers">{points(display)}</span>
      <small>PTS</small>
    </span>
  );
}
