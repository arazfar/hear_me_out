const loaded = new WeakMap<BaseAudioContext, Set<string>>();

/** Our worklets are self-contained. Fetch their code with the owning attempt's
 * signal: addModule(url) caches pending downloads and cannot itself be aborted. */
export async function loadWorklet(
  context: BaseAudioContext,
  path: string,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  let modules = loaded.get(context);
  if (!modules) loaded.set(context, (modules = new Set()));
  if (modules.has(path)) return;
  const response = await fetch(path, { signal });
  signal.throwIfAborted();
  if (!response.ok) throw new Error("Audio download failed.");
  const code = await response.text();
  signal.throwIfAborted();
  const url = URL.createObjectURL(
    new Blob([code], { type: "text/javascript" }),
  );
  const release = () => URL.revokeObjectURL(url);
  signal.addEventListener("abort", release, { once: true });
  try {
    try {
      await context.audioWorklet.addModule(url);
      // A late successful evaluation still loaded the module into this context.
      // Record that fact, but leave node publication to the current owner.
      modules.add(path);
    } catch (error) {
      // An older evaluation may have registered the processor in the meantime.
      if (!modules.has(path)) throw error;
    }
    signal.throwIfAborted();
  } finally {
    signal.removeEventListener("abort", release);
    release();
  }
}
