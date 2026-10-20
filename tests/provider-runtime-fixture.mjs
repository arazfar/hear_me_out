import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { WebSocketServer } from "ws";

const { cartesia, InkSession, inkTransport } = await import(
  pathToFileURL(process.argv[2]).href
);

async function within(promise, milliseconds) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Exceeded ${milliseconds} ms`)),
          milliseconds,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function until(predicate) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await delay(10);
  }
  assert.fail("Condition did not become true within one second");
}

function session(baseURL, finals = []) {
  // Use the real factory, configured through the SDK's public API.
  const sdk = cartesia().withOptions({ baseURL });
  return new InkSession(
    "player",
    "round",
    "turn",
    {
      segment: (segment) => finals.push(segment.text),
      caption() {},
      start() {},
      end() {},
      error() {},
    },
    inkTransport(
      sdk.stt.autoFinalize.websocket({
        model: "ink-2",
        encoding: "pcm_s16le",
        sample_rate: 16000,
      }),
    ),
  );
}

async function provider(t, onDrain, ignoreClose = true) {
  const server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await once(server, "listening");
  t.after(async () => {
    for (const socket of server.clients) socket.terminate();
    await new Promise((resolve) => server.close(resolve));
  });
  server.on("connection", (socket) => {
    // Continue reading so TCP EOF is observable, but refuse the close handshake.
    if (ignoreClose) socket.close = () => {};
    socket.send(JSON.stringify({ type: "connected" }));
    socket.on("message", (data, binary) => {
      if (!binary && JSON.parse(data.toString()).type === "close")
        onDrain(socket);
    });
  });
  return {
    server,
    baseURL: `http://127.0.0.1:${server.address().port}`,
  };
}

test("five terminal failures dispose uncooperative transports within one second", async (t) => {
  const { server, baseURL } = await provider(t, (socket) => {
    socket.send(JSON.stringify({ type: "error", error: "terminal failure" }));
  });
  for (let i = 0; i < 5; i++) {
    const stream = session(baseURL);
    await until(() => stream.connected);
    stream.send(Buffer.alloc(640, 17));
    const started = performance.now();
    assert.equal(await within(stream.close(), 1000), false);
    await until(() => server.clients.size === 0);
    assert(performance.now() - started < 1000);
  }
});

test("failure during an unanswered upgrade disposes the pending connection", async (t) => {
  const server = createServer();
  const sockets = new Set();
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    // HTTP upgrade sockets allow half-open TCP connections. Finish our side
    // after client EOF so the fixture does not retain an already-closed client.
    socket.on("end", () => socket.end());
  });
  server.on("upgrade", (_request, socket) => socket.resume());
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  });
  const upgraded = once(server, "upgrade");
  const stream = session(`http://127.0.0.1:${server.address().port}`);
  await within(upgraded, 1000);
  const started = performance.now();
  stream.fail(new Error("Canceled during handshake"));
  assert.equal(await within(stream.close(), 1000), false);
  await until(() => sockets.size === 0);
  assert(performance.now() - started < 1000);
});

test("an unresponsive normal drain retains its five-second deadline", async (t) => {
  const { server, baseURL } = await provider(t, () => {});
  const stream = session(baseURL);
  await until(() => stream.connected);
  stream.send(Buffer.alloc(640, 17));
  const started = performance.now();
  assert.equal(await within(stream.close(), 6000), false);
  await until(() => server.clients.size === 0);
  assert(performance.now() - started >= 4900);
  assert(performance.now() - started < 6000);
});

test("delayed final evidence is delivered exactly once before clean settlement", async (t) => {
  const { server, baseURL } = await provider(
    t,
    (socket) => {
      setTimeout(() => {
        socket.send(
          JSON.stringify({
            type: "turn.end",
            transcript: "Complete evidence.",
          }),
        );
        socket.close(1000);
      }, 50);
    },
    false,
  );
  const finals = [];
  const stream = session(baseURL, finals);
  await until(() => stream.connected);
  stream.send(Buffer.alloc(640, 17));
  assert.equal(await within(stream.close(), 1000), true);
  assert.deepEqual(finals, ["Complete evidence."]);
  assert.equal(await stream.close(), true);
  await until(() => server.clients.size === 0);
  assert.deepEqual(finals, ["Complete evidence."]);
});
