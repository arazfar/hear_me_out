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
  const response = await fetch(path, { signal, cache: "no-store" });
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

/** Let the processor relinquish its active-source flag before closing the context. */
export function retireWorklet(node: AudioWorkletNode | null) {
  if (!node) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      node.onprocessorerror = null;
      node.port.onmessage = null;
      node.port.close();
      node.disconnect();
      resolve();
    };
    // Older cached processors or an unavailable audio device may never render again.
    const timer = setTimeout(finish, 500);
    node.onprocessorerror = finish;
    node.port.onmessage = ({ data }) => {
      if (data.type === "retired") finish();
    };
    node.port.postMessage({ type: "retire" });
  });
}
