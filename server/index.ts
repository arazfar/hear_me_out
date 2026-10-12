import "dotenv/config";
import { createApp } from "./app.js";
const runtime = createApp();
const port = Number(process.env.PORT || 3000);
runtime.server.listen(port, "0.0.0.0", () =>
  console.log(`Hear Me Out listening on :${port}. Recordings off.`),
);
process.on("SIGTERM", runtime.close);
process.on("SIGINT", runtime.close);
