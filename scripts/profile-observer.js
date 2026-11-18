// Installed only in the profiler's isolated browser contexts.
function installFrameObserver() {
  const progress = { local: 0, remote: 0, relay: 0 };
  const cues = [];
  const done = [];
  window.gameInteractions = { cues, done };
  function observeVisible(check, record) {
    const received = performance.now();
    const tick = () => {
      const now = performance.now();
      if (check()) record(now - received, performance.timeOrigin + now);
      else if (now - received < 2000) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  // Attach once per control socket. Skip binary channels entirely.
  const observedSockets = new WeakSet();
  document.addEventListener(
    "click",
    (event) => {
      if (
        event.target instanceof Element &&
        event.target.closest(".yield-button")
      )
        observeVisible(
          () => !!document.querySelector(".turn-panel.is-settling"),
          (ms) => done.push(ms),
        );
    },
    true,
  );
  const send = WebSocket.prototype.send;
  WebSocket.prototype.send = function (data) {
    if (typeof data === "string" && this.url.endsWith("/socket/control")) {
      if (!observedSockets.has(this)) {
        observedSockets.add(this);
        this.addEventListener("message", ({ data }) => {
          if (typeof data !== "string" || !data.includes('"floor_opened"'))
            return;
          const event = JSON.parse(data);
          if (event.type !== "floor_opened") return;
          const player = event.snapshot.players.find(
            (p) => p.id === event.payload.playerId,
          );
          observeVisible(
            () => {
              const face = document.querySelector(".face.has-floor");
              return (
                face?.getAttribute("aria-label")?.split(",")[0] ===
                  player?.name && !!face.querySelector(".listening-badge")
              );
            },
            (ms, visibleAt) =>
              cues.push({ turn: event.payload.turnId, ms, visibleAt }),
          );
        });
      }
      if (data.includes('"media_status"')) {
        const { command } = JSON.parse(data);
        if (command?.type === "media_status") {
          progress.local = command.localFrames;
          progress.remote = command.remoteFrames;
        }
      } else if (data.includes('"video_ack"') && !JSON.parse(data).probe) {
        progress.relay++;
      }
    }
    return send.call(this, data);
  };
  let frame = 0;
  let start = 0;
  let previous = 0;
  let hidden = false;
  let initialQuality = null;
  let camera = { ...progress };
  let intervals = [];
  let longTasks = [];
  const quality = () =>
    document
      .querySelector(".stage[data-quality]")
      ?.getAttribute("data-quality") ?? null;
  const observer = new PerformanceObserver((list) => {
    longTasks.push(...list.getEntries().map((entry) => entry.duration));
  });
  const visibility = () => {
    hidden ||= document.hidden;
  };
  const tick = (time) => {
    if (previous) intervals.push(time - previous);
    previous = time;
    frame = requestAnimationFrame(tick);
  };
  window.gameFrameObserver = {
    start() {
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener("visibilitychange", visibility);
      start = performance.now();
      previous = 0;
      hidden = document.hidden;
      camera = { ...progress };
      initialQuality = quality();
      intervals = [];
      longTasks = [];
      observer.observe({ entryTypes: ["longtask"] });
      document.addEventListener("visibilitychange", visibility);
      frame = requestAnimationFrame(tick);
    },
    finish() {
      cancelAnimationFrame(frame);
      longTasks.push(...observer.takeRecords().map((entry) => entry.duration));
      observer.disconnect();
      document.removeEventListener("visibilitychange", visibility);
      return {
        intervals,
        longTasks,
        durationMs: performance.now() - start,
        hidden,
        initialQuality,
        finalQuality: quality(),
        cameraDelta: {
          local: progress.local - camera.local,
          remote: progress.remote - camera.remote,
          relay: progress.relay - camera.relay,
        },
      };
    },
  };
  if (new URLSearchParams(location.search).has("profileColdTitle"))
    window.gameFrameObserver.start();
}
installFrameObserver();
