import "dotenv/config";
import { createApp } from "./app.js";
import { clearHostVoice } from "./judge/voice-cache.js";
const runtime = createApp();
const port = Number(process.env.PORT || 3000);
runtime.server.listen(port, "0.0.0.0", () =>
  console.log(`Hear Me Out listening on :${port}. Recordings off.`),
);
let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  const deadline = setTimeout(() => process.exit(1), 25000);
  deadline.unref();
  clearHostVoice();
  void runtime.close().then(() => {
    clearTimeout(deadline);
    process.exit(0);
  });
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
