// Installed only in the profiler's isolated browser contexts.
function installFrameObserver() {
  const progress = { local: 0, remote: 0, relay: 0 };
  const cues = [];
  const done = [];
  const cueEvidence = [];
  const doneEvidence = [];
  window.gameInteractions = { cues, done, cueEvidence, doneEvidence };
  const frameEvidence = () => ({
    status: "waiting",
    frames: 0,
    firstFrameMs: null,
    lastFrameMs: null,
    hidden: document.hidden,
  });
  function observeVisible(received, evidence, check, record, cleanup) {
    let frame;
    const finish = (status) => {
      evidence.status = status;
      clearTimeout(timeout);
      cancelAnimationFrame(frame);
      cleanup?.();
    };
    const tick = () => {
      const now = performance.now(),
        ms = now - received;
      evidence.frames++;
      evidence.firstFrameMs ??= ms;
      evidence.lastFrameMs = ms;
      evidence.hidden ||= document.hidden;
      if (ms <= 2000 && !document.hidden && check()) {
        record(ms, performance.timeOrigin + now);
        finish("visible");
      } else if (ms < 2000) frame = requestAnimationFrame(tick);
      else finish("missed");
    };
    const timeout = setTimeout(
      () => finish("missed"),
      Math.max(0, received + 2000 - performance.now()),
    );
    frame = requestAnimationFrame(tick);
  }
  // Attach once per control socket. Skip binary channels entirely.
  const observedSockets = new WeakSet();
  window.armProfileDone = () =>
    doneEvidence.push({
      ...frameEvidence(),
      status: "armed",
      clicked: false,
      clickedAt: null,
      target: null,
      panelAtClick: null,
      settlingCommitted: false,
      lastPanelClass: null,
    });
  document.addEventListener(
    "click",
    (event) => {
      const evidence = doneEvidence.at(-1);
      if (evidence?.status !== "armed") return;
      evidence.clicked = true;
      evidence.clickedAt = event.timeStamp;
      evidence.target =
        event.target instanceof Element ? event.target.localName : null;
      if (!(
        event.target instanceof Element && event.target.closest(".yield-button")
      )) {
        evidence.status = "unmatched";
        return;
      }
      evidence.status = "waiting";
      const panel = document.querySelector(".turn-panel");
      evidence.panelAtClick = panel?.className ?? null;
      const readPanel = () => {
        const active = document.querySelector(".turn-panel");
        evidence.lastPanelClass = active?.className ?? null;
        return active?.classList.contains("is-settling");
      };
      evidence.settlingCommitted = !!readPanel();
      // A DOM commit may be superseded before any animation frame observes it.
      // Record that distinction without counting the mutation as a visible cue.
      const observer = new MutationObserver((changes) => {
        evidence.settlingCommitted ||=
          !!readPanel() ||
          changes.some((change) =>
            change.oldValue?.split(/\s+/).includes("is-settling"),
          );
      });
      if (panel)
        observer.observe(panel, {
          attributes: true,
          attributeFilter: ["class"],
          attributeOldValue: true,
        });
      observeVisible(
        event.timeStamp,
        evidence,
        readPanel,
        (ms) => {
          evidence.settlingCommitted = true;
          done.push(ms);
        },
        () => observer.disconnect(),
      );
    },
    true,
  );
  const send = WebSocket.prototype.send;
  WebSocket.prototype.send = function (data) {
    if (typeof data === "string" && this.url.endsWith("/socket/control")) {
      if (!observedSockets.has(this)) {
        observedSockets.add(this);
        this.addEventListener("message", ({ data, timeStamp }) => {
          if (typeof data !== "string" || !data.includes('"floor_opened"'))
            return;
          const event = JSON.parse(data);
          if (event.type !== "floor_opened") return;
          const player = event.snapshot.players.find(
            (p) => p.id === event.payload.playerId,
          );
          const evidence = {
            ...frameEvidence(),
            turn: event.payload.turnId,
            receivedAt: timeStamp,
            ownerMatched: false,
            badgePresent: false,
          };
          cueEvidence.push(evidence);
          observeVisible(
            // Client.onmessage ran first. The native event timestamp includes
            // the synchronous parse, state update and subscriber work.
            timeStamp,
            evidence,
            () => {
              const face = document.querySelector(".face.has-floor");
              evidence.ownerMatched =
                !!player &&
                face?.getAttribute("aria-label")?.split(",")[0] === player.name;
              evidence.badgePresent = !!face?.querySelector(".listening-badge");
              return evidence.ownerMatched && evidence.badgePresent;
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
