import "dotenv/config";
import { InkSession } from "../server/providers";
let failures = 0;
const ink = new InkSession("idle", "round", null, {
  caption: () => {},
  segment: () => {},
  start: () => {},
  end: () => {},
  error: () => failures++,
});
await new Promise((r) => setTimeout(r, 500));
ink.ws.close();
await new Promise((r) => setTimeout(r, 150));
for (let i = 0; i < 50; i++) ink.send(Buffer.alloc(640));
await new Promise((r) => setTimeout(r, 100));
ink.close();
console.log(
  JSON.stringify({ closedSocketHandled: true, failures, processAlive: true }),
);
if (failures !== 1) process.exitCode = 1;
