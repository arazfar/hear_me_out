export const JUDGE_BUDGET_MS = 12000;
export type JudgeFailureCategory =
  | "timeout"
  | "transport"
  | "quota"
  | "authentication"
  | "configuration"
  | "invalid_output";

/** Only bounded metadata leaves the provider boundary. */
export class JudgeFailure extends Error {
  constructor(
    readonly category: JudgeFailureCategory,
    readonly retryable = category !== "authentication" &&
      category !== "configuration" &&
      category !== "timeout",
  ) {
    super(`Judge failure: ${category}`);
  }
}

export function judgeFailure(error: unknown): JudgeFailure {
  if (error instanceof JudgeFailure) return error;
  const detail = error as { status?: number; code?: string } | null;
  const status = detail?.status;
  if (detail?.code === "insufficient_quota")
    return new JudgeFailure("quota", false);
  if (detail?.code === "rate_limit_exceeded") return new JudgeFailure("quota");
  if (
    ["invalid_api_key", "permission_denied"].includes(detail?.code || "") ||
    status === 401 ||
    status === 403
  )
    return new JudgeFailure("authentication");
  if (["model_not_found", "invalid_prompt"].includes(detail?.code || ""))
    return new JudgeFailure("configuration");
  if (status === 429) return new JudgeFailure("quota");
  if (status === 408 || status === 409) return new JudgeFailure("transport");
  if (status && status >= 400 && status < 500)
    return new JudgeFailure("configuration");
  return new JudgeFailure("transport");
}

/** The budget covers headers AND body consumption. The owner signal stays
 * untouched, so deadline failure can still settle the owning job. A race also
 * bounds a misbehaving service; real transports must honor the supplied signal. */
export async function withJudgeDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  owner?: AbortSignal,
  timers = { setTimeout, clearTimeout },
): Promise<T> {
  owner?.throwIfAborted();
  const request = new AbortController();
  const cancel = () => request.abort(owner?.reason);
  owner?.addEventListener("abort", cancel, { once: true });
  const timer = timers.setTimeout(
    () => request.abort(new JudgeFailure("timeout")),
    JUDGE_BUDGET_MS,
  );
  let aborted!: () => void;
  const interrupted = new Promise<never>((_, reject) => {
    aborted = () => reject(request.signal.reason);
    request.signal.addEventListener("abort", aborted, { once: true });
  });
  try {
    return await Promise.race([operation(request.signal), interrupted]);
  } finally {
    timers.clearTimeout(timer);
    owner?.removeEventListener("abort", cancel);
    request.signal.removeEventListener("abort", aborted);
  }
}
