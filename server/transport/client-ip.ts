import type { IncomingMessage } from "node:http";
import { isIP } from "node:net";

export function trustedProxyHops(value = process.env.TRUST_PROXY_HOPS || "0") {
  if (!/^[0-9]$/.test(value))
    throw new Error("TRUST_PROXY_HOPS must be an integer from 0 to 9");
  return Number(value);
}

/** Read from the trusted end of the chain, never an arbitrary client prefix. */
export function createClientIpResolver(hops: number) {
  if (!Number.isInteger(hops) || hops < 0 || hops > 9)
    throw new Error("Invalid trusted proxy hop count");
  return (req: IncomingMessage) => {
    const remote = req.socket.remoteAddress || "unknown";
    const forwarded = req.headers["x-forwarded-for"];
    if (!hops || typeof forwarded !== "string" || forwarded.length > 2048)
      return remote;
    const chain = forwarded.split(",").map((part) => part.trim());
    // A shorter chain cannot prove the configured path. Fail closed to the peer.
    if (
      chain.length < hops ||
      chain.slice(-hops).some((address) => !isIP(address))
    )
      return remote;
    const address = chain[chain.length - hops];
    return address.startsWith("::ffff:") && isIP(address.slice(7)) === 4
      ? address.slice(7)
      : address;
  };
}
export type ClientIp = ReturnType<typeof createClientIpResolver>;
