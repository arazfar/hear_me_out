import assert from "node:assert/strict";
import test from "node:test";
import { readinessPresentation } from "../src/ui/readiness";
import type { Player } from "../shared/domain";

const local = {
  reconnecting: false,
  hasStream: true,
  micOff: false,
  cameraOff: false,
  busy: false,
  error: "",
};
const player = (name: string, blockers: string[] = []): Player => ({
  id: name,
  name,
  connected: true,
  ready: false,
  mediaReady: blockers.length === 0,
  captureReady: true,
  cameraOn: true,
  wins: 0,
  scoreUnits: 0,
  readiness: { setup: "passed", blockers },
});

test("readiness distinguishes privacy, stopped capture, speech and automatic connections", () => {
  const peer = player("Sam");
  assert.deepEqual(
    readinessPresentation(player("Alex", ["microphone"]), peer, {
      ...local,
      micOff: true,
    }),
    {
      message: "Mic off.",
      icon: "mic",
      action: "privacy",
      label: "Turn mic on",
    },
  );
  assert.deepEqual(
    readinessPresentation(player("Alex", ["camera"]), peer, local),
    {
      message: "Your camera stopped.",
      icon: "camera",
      action: "check",
      label: "Restart camera",
      repair: "camera",
    },
  );
  for (const [blocker, message, action] of [
    ["microphone", "Your mic stopped.", "check"],
    ["speech_check", "Bonk needs a quick mic check.", "check"],
    ["transcription", "Connecting to Bonk…", undefined],
    ["camera_delivery", "Reconnecting video…", undefined],
    ["foreground", "Keep this tab open to play.", undefined],
  ] as const) {
    const result = readinessPresentation(
      player("Alex", [blocker]),
      peer,
      local,
    );
    assert.equal(result.message, message);
    assert.equal(result.action, action);
  }
});

test("local repairs take precedence; peer-only problems identify the affected friend and capability", () => {
  const peer = player("Sam", ["microphone", "speech_check"]);
  assert.equal(
    readinessPresentation(player("Alex", ["camera", "peer_video"]), peer, local)
      .label,
    "Restart camera",
  );
  assert.equal(
    readinessPresentation(player("Alex", ["peer_video"]), peer, local).message,
    "Waiting for Sam’s mic.",
  );
  assert.equal(
    readinessPresentation(
      player("Alex"),
      player("Sam", ["speech_check"]),
      local,
    ).message,
    "Waiting for Sam’s mic check.",
  );
  assert.equal(
    readinessPresentation(
      player("Alex"),
      player("Sam", ["transcription"]),
      local,
    ).message,
    "Connecting Sam to Bonk…",
  );
  assert.equal(
    readinessPresentation(player("Alex", ["camera"]), peer, {
      ...local,
      reconnecting: true,
    }).message,
    "Reconnecting…",
  );
});

test("stale observations show connection recovery before secondary device failures", () => {
  const result = readinessPresentation(
    player("Alex", ["connection", "microphone", "camera"]),
    player("Sam"),
    local,
  );
  assert.deepEqual(result, { message: "Reconnecting…", icon: "connection" });
  assert.deepEqual(
    readinessPresentation(
      player("Alex", ["peer_video"]),
      player("Sam", ["connection", "microphone", "camera"]),
      local,
    ),
    { message: "Waiting for Sam to reconnect.", icon: "connection" },
  );
  assert.deepEqual(
    readinessPresentation(player("Alex", ["camera_delivery"]), player("Sam"), {
      ...local,
      error: "Your camera is busy.",
      repair: "camera",
    }),
    { message: "Reconnecting video…", icon: "connection" },
  );
});

test("exhausted connection recovery offers one retry before any device or peer repair", () => {
  assert.deepEqual(
    readinessPresentation(
      player("Alex", ["connection", "microphone", "camera"]),
      player("Sam", ["speech_check"]),
      { ...local, reconnecting: true, offline: true, micOff: true },
    ),
    {
      message: "Connection lost. Check your network.",
      icon: "connection",
      action: "connection",
      label: "Retry connection",
    },
  );
});

test("recovery icons classify capabilities without inspecting authored messages", () => {
  for (const [blockers, icon] of [
    [["microphone"], "mic"],
    [["speech_check"], "mic"],
    [["camera"], "camera"],
    [["microphone", "camera"], "warning"],
    [["connection", "camera"], "connection"],
    [["transcription"], "connection"],
    [["camera_delivery"], "connection"],
    [["peer_video"], "connection"],
  ] as const) {
    assert.equal(
      readinessPresentation(player("Alex", [...blockers]), player("Sam"), local)
        .icon,
      icon,
    );
  }
  assert.equal(
    readinessPresentation(player("Alex"), player("Sam"), {
      ...local,
      hasStream: false,
    }).icon,
    undefined,
  );
  assert.equal(
    readinessPresentation(player("Alex", ["microphone"]), player("Sam"), {
      ...local,
      hasStream: false,
    }).icon,
    "warning",
  );
});
