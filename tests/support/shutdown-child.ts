import { createApp } from "../../server/app";
import { installShutdownHandlers } from "../../server/shutdown";
import { services, fakeTranscription } from "../fixtures";

const mode = process.argv[2];
const runtime = createApp({ services: services() });
const room = runtime.registry.createRoom("1234");
runtime.registry.rooms.set("1234", room);
let calls = 0;
const stream = fakeTranscription(null, "");
stream.close = () => {
  calls++;
  process.send?.({ closing: calls });
  if (mode === "stalled") {
    // Model a provider transport that keeps the event loop alive indefinitely.
    setInterval(() => {}, 1000);
    return new Promise<boolean>(() => {});
  }
  return new Promise<boolean>((resolve) =>
    setTimeout(() => {
      process.send?.({ disposed: calls });
      resolve(true);
    }, 150),
  );
};
room.transcription.active.add(stream);
room.transcription.ink.set("player", stream);
if (mode === "rejected") {
  const rejected = fakeTranscription(null, "");
  rejected.close = async () => {
    throw new Error("PRIVATE_PROVIDER_PAYLOAD");
  };
  room.transcription.active.add(rejected);
}
installShutdownHandlers(runtime.close, () => {
  process.send?.({ voiceCancelled: true });
  if (mode !== "stalled")
    setTimeout(() => process.send?.({ voiceDisposed: true }), 250);
});
runtime.server.listen(0, "127.0.0.1", () => {
  process.send?.({ ready: true });
});
