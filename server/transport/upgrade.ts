/** Upgrade validation must never throw from Node's request event handler. */
export function acceptUpgrade(
  url: string | undefined,
  host: string | undefined,
  origin: string | undefined,
) {
  try {
    if (!host || !url?.startsWith("/")) return false;
    const parsed = new URL(url, "http://localhost");
    if (
      !["/socket/control", "/socket/audio", "/socket/video"].includes(
        parsed.pathname,
      ) ||
      parsed.search
    )
      return false;
    if (!origin) return true; // Non-browser test and operational clients still authenticate.
    const source = new URL(origin);
    return (
      ["http:", "https:"].includes(source.protocol) &&
      source.host === host &&
      source.origin === origin
    );
  } catch {
    return false;
  }
}
