import type { Player } from "../../shared/domain";

export type ReadinessPresentation = {
  message: string;
  action?: "privacy" | "check" | "connection";
  label?: string;
  repair?: "camera";
};

export function readinessPresentation(
  me: Player | undefined,
  other: Player | undefined,
  local: {
    reconnecting: boolean;
    offline?: boolean;
    hasStream: boolean;
    micOff: boolean;
    cameraOff: boolean;
    busy: boolean;
    error: string;
    repair?: "camera";
  },
): ReadinessPresentation {
  const blockers = me?.readiness?.blockers || [];
  const check = (
    message: string,
    repair?: "camera",
    label = "Check mic & camera",
  ) => ({ message, action: "check", label, repair }) as ReadinessPresentation;
  if (local.offline)
    return {
      message: "Connection lost. Check your network.",
      action: "connection",
      label: "Retry connection",
    };
  if (!me?.connected || local.reconnecting) return { message: "Reconnecting…" };
  if (blockers.includes("foreground"))
    return { message: "Keep this tab open to play." };
  if (blockers.includes("connection") && local.hasStream)
    return { message: "Reconnecting…" };
  if (local.busy) return check("", local.repair);
  if (!me.mediaReady) {
    if (local.micOff || local.cameraOff)
      return {
        message:
          local.micOff && local.cameraOff
            ? "Mic and camera off."
            : local.micOff
              ? "Mic off."
              : "Camera off.",
        action: "privacy",
        label:
          local.micOff && local.cameraOff
            ? "Turn mic & camera on"
            : local.micOff
              ? "Turn mic on"
              : "Turn camera on",
      };
    if (!local.hasStream) return check("Reconnect your mic and camera.");
    if (blockers.includes("camera"))
      return blockers.includes("microphone")
        ? check("Your mic and camera stopped.", "camera")
        : check("Your camera stopped.", "camera", "Restart camera");
    if (blockers.includes("microphone")) return check("Your mic stopped.");
    if (blockers.includes("speech_check"))
      return check("Bonk needs a quick mic check.");
    if (blockers.includes("connection")) return { message: "Reconnecting…" };
    if (blockers.includes("transcription"))
      return { message: "Connecting to Bonk…" };
    if (blockers.includes("camera_delivery"))
      return { message: "Reconnecting video…" };
  }
  const name = other?.name || "your friend";
  if (!other) return { message: "Waiting for your friend" };
  if (!other.connected) return { message: `Waiting for ${name} to reconnect.` };
  const peer = other.readiness?.blockers || [];
  if (peer.includes("connection"))
    return { message: `Waiting for ${name} to reconnect.` };
  if (peer.includes("foreground"))
    return { message: `Waiting for ${name} to return.` };
  if (peer.includes("microphone"))
    return { message: `Waiting for ${name}’s mic.` };
  if (peer.includes("camera"))
    return { message: `Waiting for ${name}’s camera.` };
  if (peer.includes("speech_check"))
    return { message: `Waiting for ${name}’s mic check.` };
  if (peer.includes("transcription"))
    return { message: `Connecting ${name} to Bonk…` };
  if (
    blockers.includes("peer_video") ||
    peer.includes("camera_delivery") ||
    peer.includes("peer_video")
  )
    return { message: "Reconnecting video…" };
  if (!me.mediaReady) return { message: "Checking your connection…" };
  if (!other.mediaReady) return { message: `Checking ${name}’s connection…` };
  return { message: "" };
}
