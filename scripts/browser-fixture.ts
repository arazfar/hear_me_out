/** Local-only browser acceptance server. Never loaded by the production entrypoint. */
import { createApp } from "../server/app";
import { services } from "../tests/fixtures";
const runtime = createApp({ providersReady: () => true, services: services() });
const port = Number(process.env.PORT || 3002);
runtime.server.listen(port, "127.0.0.1", () =>
  console.log(`Browser fixture on ${port}`),
);
process.on("SIGINT", runtime.close);
process.on("SIGTERM", runtime.close);
