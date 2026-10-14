import { createHmac } from "node:crypto";
/** coturn REST credentials. The shared secret never leaves the server. */
export function iceConfiguration(subject: string, now = Date.now()) {
  const expiresAt = now + 10 * 60 * 1000;
  const iceServers: {
    urls: string | string[];
    username?: string;
    credential?: string;
  }[] = [{ urls: "stun:stun.l.google.com:19302" }];
  const urls = (process.env.TURN_URLS || "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^turns?:/.test(s));
  if (urls.length && process.env.TURN_SECRET) {
    const username = `${Math.floor(expiresAt / 1000)}:${subject}`;
    iceServers.push({
      urls,
      username,
      credential: createHmac("sha1", process.env.TURN_SECRET)
        .update(username)
        .digest("base64"),
    });
  }
  return { iceServers, expiresAt };
}
