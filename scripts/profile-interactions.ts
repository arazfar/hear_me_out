import { writeFile } from "node:fs/promises";

interface FrameObservation {
  status: "armed" | "waiting" | "visible" | "missed" | "unmatched";
  frames: number;
  firstFrameMs: number | null;
  lastFrameMs: number | null;
  hidden: boolean;
}

export interface InteractionObservations {
  cues: { turn: string; ms: number; visibleAt: number }[];
  done: number[];
  cueEvidence: (FrameObservation & {
    turn: string;
    receivedAt: number;
    ownerMatched: boolean;
    badgePresent: boolean;
  })[];
  doneEvidence: (FrameObservation & {
    clicked: boolean;
    clickedAt: number | null;
    target: string | null;
    panelAtClick: string | null;
    settlingCommitted: boolean;
    lastPanelClass: string | null;
  })[];
}

export function missingInteractions(
  observed: InteractionObservations[],
  speaker: number,
  nextTurn: string | null,
) {
  const missing: string[] = [];
  if (observed[speaker].done.length !== 1)
    missing.push("Missing or duplicate visible Done acknowledgment");
  if (!nextTurn) missing.push("Missing open successor after Done");
  else
    observed.forEach((seat, i) => {
      if (!seat.cues.some((cue) => cue.turn === nextTurn))
        missing.push("Missing visible successor cue on seat " + (i + 1));
    });
  return missing;
}

interface ProfileCohort {
  completed: boolean;
  results: {
    round: number;
    checkout: number;
    transport: string;
    measurement: { interactions: { failures: string[] } };
  }[];
}

/** Frame cohorts remain available when a separate interaction gate fails. */
export async function saveCompletedProfile(
  output: string,
  report: ProfileCohort,
) {
  report.completed = true;
  await writeFile(output, JSON.stringify(report));
  const failures = report.results.flatMap((r) =>
    r.measurement.interactions.failures.map(
      (reason) =>
        `round ${r.round}, checkout ${r.checkout}, ${r.transport}: ${reason}`,
    ),
  );
  if (failures.length)
    throw Error("Profile interaction gates failed:\n" + failures.join("\n"));
}
