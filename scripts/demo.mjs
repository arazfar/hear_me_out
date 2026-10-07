import { spawn } from "node:child_process";
let child,
  stopping = false,
  failures = 0,
  timer;
function start() {
  child = spawn(process.execPath, ["dist-server/index.js"], {
    stdio: "inherit",
    env: process.env,
  });
  child.on("exit", (code) => {
    if (stopping) return;
    failures++;
    if (failures > 3) {
      console.error(
        "Demo server stopped after repeated failures. Inspect the last error before restarting.",
      );
      process.exit(code || 1);
    }
    console.error(
      "Demo server exited; restarting. Active rooms are ephemeral.",
    );
    timer = setTimeout(start, 1000);
  });
}
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    stopping = true;
    clearTimeout(timer);
    child?.kill(signal);
  });
start();
