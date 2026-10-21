/** Start every cleanup immediately; one failure must not skip another owner. */
export async function settleCleanup(actions: Array<() => unknown>) {
  const results = await Promise.allSettled(
    actions.map((action) => {
      try {
        return action();
      } catch {
        return Promise.reject(new Error("Cleanup failed"));
      }
    }),
  );
  return results.every(
    (result) => result.status === "fulfilled" && result.value !== false,
  );
}

export function installShutdownHandlers(
  close: () => Promise<boolean>,
  cancelVoice: () => void,
) {
  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    const deadline = setTimeout(() => {
      console.error("Shutdown exceeded its 25-second deadline.");
      process.exit(1);
    }, 25000);
    deadline.unref();
    void settleCleanup([cancelVoice, close]).then((ok) => {
      if (!ok) console.error("Shutdown cleanup did not complete cleanly.");
      process.exitCode = ok ? 0 : 1;
      // Natural exit lets cancelled providers finish releasing their transports.
      // The unreferenced deadline still bounds any remaining live handles.
    });
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
