import { useEffect, useState } from "react";
import { client } from "../game/client";

export function useMediaVersion() {
  const [version, setVersion] = useState(0);
  useEffect(
    () =>
      client.on((u) => {
        if (u.media || u.connection) setVersion((v) => v + 1);
      }),
    [],
  );
  return version;
}
export function useServerNow() {
  const [now, setNow] = useState(() => client.serverNow());
  useEffect(() => {
    const timer = setInterval(() => setNow(client.serverNow()), 100);
    return () => clearInterval(timer);
  }, []);
  return now;
}
export function useReducedMotion() {
  const [override, setOverride] = useState<boolean | null>(null);
  const [system, setSystem] = useState(
    () => matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const query = matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => setSystem(query.matches);
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, []);
  return [override ?? system, setOverride] as const;
}
