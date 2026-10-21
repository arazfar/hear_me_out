/** Diagnostics must never mask the test failure or prevent resource cleanup. */
export async function finishBrowserTest(
  diagnostics: () => Promise<unknown>,
  cleanups: Array<() => Promise<unknown>>,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.resolve()
        .then(diagnostics)
        .catch(() => {}),
      new Promise<void>((resolve) => (timer = setTimeout(resolve, 2000))),
    ]);
  } finally {
    clearTimeout(timer);
    await Promise.allSettled(
      cleanups.map((close) => Promise.resolve().then(close)),
    );
  }
}
