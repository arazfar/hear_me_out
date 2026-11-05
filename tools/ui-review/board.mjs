import {
  FLOWS,
  SIZES,
  catalog,
  mergeFeedback,
  completeView,
  completeState,
  unseenStep,
  locate,
  markdown,
} from "./model.mjs";
const $ = (id) => document.getElementById(id);
const el = (tag, text, cls) => {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = text;
  if (cls) n.className = cls;
  return n;
};
let manifest,
  model,
  data,
  viewed = new Set(),
  confirmed = new Set(),
  pending = new Set(),
  index = 0,
  positions = {},
  selected = null,
  draft = null,
  actual = false;
let generation = 0,
  ack = 0,
  saving = false,
  progressSaving = false,
  saveError = "",
  feedbackError = "",
  progressError = "",
  storageError = false,
  saveTimer,
  viewTimer,
  observer,
  renderToken = 0,
  ready = false;
let feedbackKey, progressKey, sessionKey;
const storage = {
  read(key, session = false) {
    try {
      return JSON.parse(
        (session ? sessionStorage : localStorage).getItem(key) || "null",
      );
    } catch {
      storageError = true;
      return null;
    }
  },
  write(key, value, session = false) {
    try {
      (session ? sessionStorage : localStorage).setItem(
        key,
        JSON.stringify(value),
      );
      return true;
    } catch {
      storageError = true;
      return false;
    }
  },
};
async function request(url, body) {
  const r = await fetch(
    url,
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  if (!r.ok)
    throw Error(
      `${url.includes("progress") ? "Progress" : "Comments"} ${body === undefined ? "could not load" : "could not save"} (${r.status}).`,
    );
  return r.json();
}
function cache() {
  // Preserve other tabs' queued work before updating this shared browser backup.
  const local = storage.read(feedbackKey);
  if (local?.reviewId === manifest.id && local.dirty) {
    const merged = mergeFeedback(data, local);
    if (JSON.stringify(merged.comments) !== JSON.stringify(data.comments)) {
      data = merged;
      generation++;
    }
  }
  const queued = storage.read(progressKey);
  for (const id of queued?.viewedCaptureIds || []) {
    if (model.captures.has(id) && !confirmed.has(id)) {
      pending.add(id);
      viewed.add(id);
    }
  }
  storage.write(feedbackKey, { ...data, dirty: generation > ack });
  storage.write(progressKey, {
    reviewId: manifest.id,
    viewedCaptureIds: [...pending],
  });
  status();
}
function status() {
  if (!ready) return;
  const dirty =
    generation > ack || pending.size > 0 || saving || progressSaving;
  saveError = feedbackError || progressError;
  const message =
    saveError ||
    (storageError
      ? dirty
        ? "Browser storage unavailable. Keep this tab open until saved."
        : "Saved · browser draft storage unavailable."
      : "");
  $("save-status").textContent = message || (dirty ? "Saving…" : "Saved");
  $("save-status").classList.toggle("error", !!message);
  $("retry").hidden = !saveError;
}
function change() {
  generation++;
  cache();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushFeedback, 350);
}
async function flushFeedback() {
  if (!ready || saving || generation === ack) return;
  const sent = generation,
    body = structuredClone(data);
  saving = true;
  status();
  try {
    const server = await request("/api/feedback", body);
    data = mergeFeedback(server, data);
    ack = sent;
    feedbackError = "";
    cache();
    renderComments();
    renderPins();
  } catch (e) {
    feedbackError = e.message;
  } finally {
    saving = false;
    status();
  }
  if (!feedbackError && generation > ack) flushFeedback();
}
async function flushProgress() {
  if (!ready || progressSaving || !pending.size) return;
  const ids = [...pending];
  progressSaving = true;
  status();
  try {
    const server = await request("/api/progress", {
      reviewId: manifest.id,
      viewedCaptureIds: ids,
    });
    server.viewedCaptureIds.forEach((id) => {
      viewed.add(id);
      confirmed.add(id);
    });
    ids.forEach((id) => pending.delete(id));
    progressError = "";
    cache();
    renderProgress();
  } catch (e) {
    progressError = e.message;
  } finally {
    progressSaving = false;
    status();
  }
  if (!progressError && pending.size) flushProgress();
}
function retry() {
  feedbackError = "";
  progressError = "";
  flushFeedback();
  flushProgress();
  status();
}
async function sync() {
  if (!ready) return;
  try {
    const [f, p] = await Promise.all([
      request("/api/feedback"),
      request("/api/progress"),
    ]);
    data = mergeFeedback(f, data);
    p.viewedCaptureIds.forEach((id) => {
      viewed.add(id);
      confirmed.add(id);
      pending.delete(id);
    });
    cache();
    renderProgress();
    renderComments();
    renderPins();
    retry();
  } catch (e) {
    feedbackError = e.message;
    status();
  }
}
function progress() {
  return {
    schemaVersion: 1,
    reviewId: manifest.id,
    viewedCaptureIds: [...viewed],
  };
}
function step() {
  return model.steps[index];
}
function savePosition() {
  if (step()) positions[step().group] = index;
  storage.write(sessionKey, { index, positions }, true);
}
function hash() {
  const s = step();
  return s
    ? "#" +
        new URLSearchParams({
          screen: s.scenario,
          viewport: s.viewport,
          frame: s.frame,
        })
    : "#end=1";
}
function go(next, push = true) {
  cancelView();
  index = Math.max(0, Math.min(model.steps.length, next));
  savePosition();
  if (push && location.hash !== hash()) history.pushState(null, "", hash());
  render();
}
function goState(id, size = "desktop", frame = 0) {
  go(
    locate(
      model,
      "#" + new URLSearchParams({ screen: id, viewport: size, frame }),
    ),
  );
}
function goFlow(group) {
  go(positions[group] ?? model.steps.findIndex((s) => s.group === group));
}
function renderProgress() {
  if (!ready) return;
  const done = (s) => completeState(model, data, viewed, s.id);
  $("overall").textContent =
    `${model.scenarios.filter(done).length}/${model.scenarios.length}`;
  for (const [i, group] of FLOWS.entries()) {
    const states = model.scenarios.filter((s) => s.group === group),
      count = states.filter(done).length;
    const button = $("flows").children[i];
    button.querySelector("small").textContent = `${count}/${states.length}`;
    button.setAttribute("aria-current", String(step()?.group === group));
    $("flow-select").options[i].textContent =
      `${group} · ${count}/${states.length}`;
  }
  if (step()) {
    for (const size of SIZES) {
      const complete = completeView(model, data, viewed, step().scenario, size);
      $(size).querySelector("span").textContent = complete ? "✓" : "○";
      $(size).setAttribute(
        "aria-label",
        `${size === "phone" ? "Phone" : "Desktop"}${complete ? ", reviewed" : ", not fully viewed"}`,
      );
      $(size).setAttribute("aria-pressed", String(step().viewport === size));
    }
    const n = SIZES.filter((size) =>
      completeView(model, data, viewed, step().scenario, size),
    ).length;
    $("state-progress").textContent = `${n}/2 sizes viewed`;
    for (const o of $("state-select").options) {
      const s = model.scenarios.find((s) => s.id === o.value);
      o.textContent = (done(s) ? "✓ " : "") + s.title;
    }
  }
  const comments = data.comments.filter((c) => !c.deleted);
  $("comment-count").textContent = comments.length;
  const remaining = unseenStep(model, data, viewed);
  $("review-remaining").hidden = remaining < 0;
  $("remaining").disabled = remaining < 0;
  $("completion-title").textContent =
    remaining < 0 ? "Review complete" : "You’ve reached the end";
  $("completion-copy").textContent =
    `${model.scenarios.filter(done).length} of ${model.scenarios.length} states viewed. ${comments.length} comments, ${comments.filter((c) => !c.resolved).length} open. Viewed does not mean approved.`;
}
function render() {
  renderToken++;
  $("review").hidden = !step();
  $("completion").hidden = !!step();
  $("previous").disabled = index === 0;
  $("next").disabled = !step();
  $("next").textContent = index === model.steps.length - 1 ? "Finish" : "Next";
  $("state-select").disabled = !step();
  if (step()) {
    const s = model.scenarios.find((s) => s.id === step().scenario);
    $("flow-label").textContent = s.group;
    $("flow-select").value = s.group;
    $("state-select").replaceChildren(
      ...model.scenarios
        .filter((x) => x.group === s.group)
        .map((x) => {
          const o = el("option", x.title);
          o.value = x.id;
          return o;
        }),
    );
    $("state-select").value = s.id;
    $("note").textContent = s.note || "";
    $("frame-label").hidden = step().total === 1;
    $("frame-select").replaceChildren(
      ...Array.from({ length: step().total }, (_, i) => {
        const o = el(
          "option",
          i ? `Continuation ${i} of ${step().total - 1}` : "Initial viewport",
        );
        o.value = i;
        return o;
      }),
    );
    $("frame-select").value = step().frame;
    renderPair();
  } else {
    cancelView();
    $("comparison").replaceChildren();
  }
  renderProgress();
  renderComments();
}
function cancelView() {
  clearTimeout(viewTimer);
  viewTimer = null;
  observer?.disconnect();
  observer = null;
}
function renderPair() {
  cancelView();
  const token = renderToken,
    s = step(),
    panes = [],
    loaded = new Set(),
    visible = new Set();
  $("comparison").replaceChildren();
  const eligible = () =>
    token === renderToken &&
    document.visibilityState === "visible" &&
    document.hasFocus() &&
    loaded.size === 2 &&
    visible.size === 2;
  const check = () => {
    if (!eligible()) {
      clearTimeout(viewTimer);
      viewTimer = null;
      return;
    }
    if (viewTimer) return;
    viewTimer = setTimeout(() => {
      viewTimer = null;
      if (!eligible()) return;
      for (const c of [s.before, s.after])
        if (!viewed.has(c.id)) {
          viewed.add(c.id);
          pending.add(c.id);
        }
      cache();
      renderProgress();
      flushProgress();
    }, 500);
  };
  observer = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.intersectionRatio >= 0.75) visible.add(e.target.dataset.version);
        else visible.delete(e.target.dataset.version);
      }
      check();
    },
    { threshold: [0, 0.75, 1] },
  );
  for (const version of ["before", "after"]) {
    const c = s[version],
      pane = el("section", undefined, "pane"),
      head = el("div", undefined, "pane-head");
    head.append(el("strong", version === "before" ? "Before" : "After"));
    const held =
      s.frame >= model.frames(s.scenario, s.viewport, version).length;
    head.append(
      el(
        "span",
        `${c.width} × ${c.height}${held ? " · Final image held" : s.frame ? " · Continuation " + s.frame : ""}`,
      ),
    );
    const viewport = el("div", undefined, "viewport");
    viewport.dataset.version = version;
    viewport.tabIndex = 0;
    viewport.setAttribute(
      "aria-label",
      `${version} screenshot. Enter to add a comment.`,
    );
    const shell = el("div", undefined, "image-shell");
    shell.dataset.capture = c.id;
    shell.style.aspectRatio = `${c.width}/${c.height}`;
    const img = el("img");
    img.alt = `${version === "before" ? "Before" : "After"}: ${model.scenarios.find((x) => x.id === s.scenario).title}, ${s.viewport}, ${c.frame ? "continuation " + c.frame : "initial viewport"}`;
    img.draggable = false;
    img.src = c.file;
    shell.append(img);
    viewport.append(shell);
    const loading = el("div", "Loading screenshot…", "image-loading");
    loading.setAttribute("role", "status");
    viewport.append(loading);
    pane.append(head, viewport);
    $("comparison").append(pane);
    panes.push(viewport);
    observer.observe(viewport);
    const decode = async () => {
      try {
        await img.decode();
        if (token !== renderToken) return;
        loading.remove();
        loaded.add(version);
        check();
      } catch {
        if (token !== renderToken) return;
        loading.remove();
        loaded.delete(version);
        check();
        shell.hidden = true;
        const error = el("div", undefined, "image-error");
        error.setAttribute("role", "alert");
        error.append(
          el(
            "p",
            "This screenshot could not load. It has not been marked viewed.",
          ),
        );
        const retry = el("button", "Retry image");
        retry.onclick = () => {
          renderToken++;
          renderPair();
        };
        error.append(retry);
        viewport.append(error);
      }
    };
    decode();
    viewport.onkeydown = (e) => {
      if (e.target !== viewport) return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        newPin(c, 0.5, 0.5);
      }
    };
    let pointer;
    img.onpointerdown = (e) => {
      if (e.button !== 0) return;
      pointer = {
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        left: viewport.scrollLeft,
        top: viewport.scrollTop,
        moved: false,
      };
      img.setPointerCapture(e.pointerId);
    };
    img.onpointermove = (e) => {
      if (!pointer) return;
      if (Math.hypot(e.clientX - pointer.x, e.clientY - pointer.y) > 5)
        pointer.moved = true;
      if (pointer.moved && actual) {
        viewport.scrollLeft = pointer.left + pointer.x - e.clientX;
        viewport.scrollTop = pointer.top + pointer.y - e.clientY;
      }
    };
    img.onpointerup = (e) => {
      if (!pointer) return;
      const moved = pointer.moved;
      pointer = null;
      if (!moved) {
        const r = img.getBoundingClientRect();
        newPin(
          c,
          Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
          Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)),
        );
      }
    };
    img.onpointercancel = () => {
      pointer = null;
    };
    viewport.onscroll = () => {
      if (viewport.dataset.syncing || !$("linked").checked) return;
      const other = panes.find((p) => p !== viewport);
      if (!other) return;
      other.dataset.syncing = "1";
      other.scrollLeft =
        (viewport.scrollLeft /
          Math.max(1, viewport.scrollWidth - viewport.clientWidth)) *
        Math.max(0, other.scrollWidth - other.clientWidth);
      other.scrollTop =
        (viewport.scrollTop /
          Math.max(1, viewport.scrollHeight - viewport.clientHeight)) *
        Math.max(0, other.scrollHeight - other.clientHeight);
      requestAnimationFrame(() => delete other.dataset.syncing);
    };
  }
  // Re-evaluate visibility after focus/visibility changes without rebuilding the editor.
  activeCheck = check;
  renderZoom();
  renderPins();
}
let activeCheck = () => {};
function renderZoom() {
  for (const shell of document.querySelectorAll(".image-shell")) {
    const c = model.captures.get(shell.dataset.capture);
    const viewport = shell.parentElement;
    const width = actual
      ? c.width
      : Math.min(
          viewport.clientWidth,
          c.width,
          (innerHeight * 0.62 * c.width) / c.height,
        );
    shell.style.width = width + "px";
    shell.style.maxWidth = "none";
    viewport.style.height = actual
      ? "62vh"
      : (width * c.height) / c.width + "px";
    shell.querySelector("img").style.touchAction = actual ? "none" : "auto";
  }
  $("fit").setAttribute("aria-pressed", String(!actual));
  $("actual").setAttribute("aria-pressed", String(actual));
}
function sidebar(open) {
  $("comments").hidden = !open;
  $("app").classList.toggle("comments-open", open);
  $("comments-toggle").setAttribute("aria-expanded", String(open));
}
function currentComment() {
  return draft?.id === selected
    ? draft
    : data.comments.find((c) => c.id === selected && !c.deleted);
}
function newPin(c, x, y) {
  draft = {
    id: crypto.randomUUID(),
    number: Math.max(0, ...data.comments.map((c) => c.number || 0)) + 1,
    reviewId: manifest.id,
    captureId: c.id,
    scenario: c.scenario,
    viewport: c.viewport,
    version: c.version,
    frame: c.frame,
    screenshot: c.file,
    screenshotSha256: c.sha256,
    x,
    y,
    text: "",
    resolved: false,
    deleted: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  selected = draft.id;
  sidebar(true);
  renderComments();
  renderPins();
  openEditor(true);
}
function openEditor(focus = false) {
  const c = currentComment();
  $("editor").hidden = !c;
  if (!c) return;
  $("editor-title").textContent =
    draft?.id === c.id ? "New comment" : `Comment ${c.number}`;
  $("attachment").textContent =
    `${c.version === "before" ? "Before" : "After"} · ${c.viewport} · ${c.frame ? "continuation " + c.frame : "initial viewport"} · ${model.scenarios.find((s) => s.id === c.scenario)?.title}`;
  if (
    document.activeElement !== $("comment-text") ||
    $("comment-text").dataset.id !== c.id
  ) {
    $("comment-text").value = c.text;
    $("comment-text").dataset.id = c.id;
  }
  $("resolve").textContent = c.resolved ? "Reopen" : "Resolve";
  $("resolve").hidden = draft?.id === c.id;
  $("delete").textContent = draft?.id === c.id ? "Cancel" : "Delete";
  if (focus) $("comment-text").focus();
}
function closeEditor() {
  draft = null;
  selected = null;
  openEditor();
  renderComments();
  renderPins();
}
function selectComment(c) {
  draft = null;
  selected = c.id;
  goState(
    c.scenario,
    c.viewport,
    model
      .frames(c.scenario, c.viewport, c.version)
      .findIndex((x) => x.id === c.captureId),
  );
  sidebar(true);
  openEditor(true);
}
function renderComments() {
  if (!ready) return;
  const list = data.comments.filter(
    (c) =>
      !c.deleted &&
      ($("all-comments").checked || !step() || c.scenario === step().scenario),
  );
  $("comment-list").replaceChildren(
    ...list.map((c) => {
      const b = el(
        "button",
        undefined,
        "comment-card" +
          (c.resolved ? " resolved" : "") +
          (c.id === selected ? " selected" : ""),
      );
      b.append(
        el(
          "small",
          `#${c.number} · ${c.version} · ${c.viewport}${c.resolved ? " · Resolved" : ""}`,
        ),
        el("span", c.text || "(Empty comment)", "body"),
      );
      b.onclick = () => selectComment(c);
      return b;
    }),
  );
  if (!list.length)
    $("comment-list").append(
      el("p", "No comments here yet. Click either image to add one.", "empty"),
    );
  openEditor();
  $("comment-count").textContent = data.comments.filter(
    (c) => !c.deleted,
  ).length;
}
function renderPins() {
  if (!ready) return;
  const focused = document.activeElement?.dataset.pin;
  for (const shell of document.querySelectorAll(".image-shell")) {
    shell.querySelectorAll(".pin").forEach((p) => p.remove());
    for (const c of [...data.comments, ...(draft ? [draft] : [])].filter(
      (c) => !c.deleted && c.captureId === shell.dataset.capture,
    )) {
      const p = el(
        "button",
        String(c.number),
        "pin" +
          (c.resolved ? " resolved" : "") +
          (c.id === selected ? " selected" : "") +
          (draft?.id === c.id ? " draft" : ""),
      );
      p.dataset.pin = c.id;
      p.style.left = c.x * 100 + "%";
      p.style.top = c.y * 100 + "%";
      p.setAttribute(
        "aria-label",
        `Comment ${c.number}: ${c.text || "New comment"}. Arrow keys move pin.`,
      );
      p.onclick = () => {
        selected = c.id;
        sidebar(true);
        renderComments();
        openEditor(true);
      };
      p.onkeydown = (e) => {
        if (
          !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)
        )
          return;
        e.preventDefault();
        e.stopPropagation();
        const delta = e.shiftKey ? 0.05 : 0.01;
        if (e.key === "ArrowLeft") c.x = Math.max(0, c.x - delta);
        if (e.key === "ArrowRight") c.x = Math.min(1, c.x + delta);
        if (e.key === "ArrowUp") c.y = Math.max(0, c.y - delta);
        if (e.key === "ArrowDown") c.y = Math.min(1, c.y + delta);
        c.updatedAt = Math.max(Date.now(), c.updatedAt + 1);
        if (c !== draft) change();
        renderPins();
      };
      shell.append(p);
      if (focused === c.id) p.focus({ preventScroll: true });
    }
  }
}
function exportFile(md) {
  const result = {
    ...data,
    dirty: generation > ack,
    progress: progress(),
    unsavedDrafts: data.comments.filter((c) => generation > ack && !c.deleted),
  };
  const blob = new Blob(
      [
        md
          ? markdown(manifest, result, result.progress)
          : JSON.stringify(result, null, 2),
      ],
      { type: md ? "text/markdown" : "application/json" },
    ),
    url = URL.createObjectURL(blob),
    a = el("a");
  a.href = url;
  a.download = `${manifest.id}-feedback.${md ? "md" : "json"}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function init() {
  ready = false;
  $("load-error").hidden = true;
  $("app").hidden = true;
  try {
    const [m, f, p] = await Promise.all([
      request("/manifest.json"),
      request("/api/feedback"),
      request("/api/progress"),
    ]);
    manifest = m;
    model = catalog(m);
    feedbackKey = "hmo-review:" + m.id;
    progressKey = "hmo-progress:" + m.id;
    sessionKey = "hmo-position:" + m.id;
    data = f;
    const local = storage.read(feedbackKey);
    if (local?.reviewId === m.id && local.dirty) {
      data = mergeFeedback(f, local);
      generation++;
    }
    viewed = new Set(p.viewedCaptureIds);
    confirmed = new Set(p.viewedCaptureIds);
    const queued = storage.read(progressKey);
    for (const id of queued?.viewedCaptureIds || [])
      if (model.captures.has(id) && !viewed.has(id)) {
        pending.add(id);
        viewed.add(id);
      }
    const session = storage.read(sessionKey, true);
    positions = session?.positions || {};
    index = locate(model, location.hash);
    if (index < 0)
      index = Math.max(0, Math.min(model.steps.length, session?.index || 0));
    $("flows").replaceChildren(
      ...FLOWS.map((group) => {
        const b = el("button");
        b.append(el("span", group), el("small"));
        b.onclick = () => goFlow(group);
        return b;
      }),
    );
    $("flow-select").replaceChildren(
      ...FLOWS.map((group) => {
        const o = el("option", group);
        o.value = group;
        return o;
      }),
    );
    $("capture-details").textContent =
      `Review ${m.id}. ${m.captures.length} immutable captures. ${m.browser}. Reduced-motion capture: ${m.reducedMotion ? "yes" : "no"}.`;
    ready = true;
    $("app").hidden = false;
    history.replaceState(null, "", hash());
    render();
    retry();
  } catch (e) {
    $("load-error").hidden = false;
    $("load-message").textContent =
      e.message + " Your saved feedback has not been replaced.";
    $("save-status").textContent = "Review unavailable";
  }
}
$("reload").onclick = init;
$("retry").onclick = retry;
$("previous").onclick = () => go(index - 1);
$("next").onclick = () => go(index + 1);
$("flow-select").onchange = (e) => goFlow(e.target.value);
$("state-select").onchange = (e) => goState(e.target.value);
$("frame-select").onchange = (e) =>
  goState(step().scenario, step().viewport, +e.target.value);
for (const size of SIZES)
  $(size).onclick = () => goState(step().scenario, size);
$("fit").onclick = () => {
  actual = false;
  renderZoom();
};
$("actual").onclick = () => {
  actual = true;
  renderZoom();
};
$("add").onclick = () => newPin(step().after, 0.5, 0.5);
$("comments-toggle").onclick = () => {
  sidebar($("comments").hidden);
  renderComments();
};
$("close-comments").onclick = () => {
  closeEditor();
  sidebar(false);
  $("comments-toggle").focus();
};
$("close-editor").onclick = () => {
  const id = selected;
  closeEditor();
  const pin = [...document.querySelectorAll(".pin")].find(
    (p) => p.dataset.pin === id,
  );
  (pin || $("add")).focus({ preventScroll: true });
};
$("all-comments").onchange = renderComments;
$("completion-comments").onclick = () => {
  sidebar(true);
  $("all-comments").checked = true;
  renderComments();
};
for (const id of ["remaining", "review-remaining"])
  $(id).onclick = () => {
    const next = unseenStep(model, data, viewed);
    if (next >= 0) go(next);
    $("more").open = false;
  };
$("export-json").onclick = () => exportFile(false);
$("export-md").onclick = () => exportFile(true);
$("comment-text").oninput = (e) => {
  const c = currentComment();
  if (!c) return;
  c.text = e.target.value;
  c.updatedAt = Math.max(Date.now(), c.updatedAt + 1);
  if (draft?.id === c.id) {
    if (!c.text.trim()) return;
    data.comments.push(c);
    draft = null;
  }
  change();
  renderComments();
  renderPins();
};
$("resolve").onclick = () => {
  const c = currentComment();
  if (!c || c === draft) return;
  c.resolved = !c.resolved;
  c.updatedAt = Math.max(Date.now(), c.updatedAt + 1);
  change();
  renderComments();
  renderPins();
};
$("delete").onclick = () => {
  const c = currentComment();
  if (c && c !== draft) {
    c.deleted = true;
    c.updatedAt = Math.max(Date.now(), c.updatedAt + 1);
    change();
  }
  closeEditor();
};
window.addEventListener("popstate", () => {
  if (ready) {
    const found = locate(model, location.hash);
    if (found >= 0) go(found, false);
  }
});
window.addEventListener("hashchange", () => {
  if (ready) {
    const found = locate(model, location.hash);
    if (found >= 0 && found !== index) go(found, false);
  }
});
window.addEventListener("blur", () => {
  clearTimeout(viewTimer);
  viewTimer = null;
});
document.addEventListener("visibilitychange", () => {
  activeCheck();
  if (document.visibilityState === "visible") sync();
});
window.addEventListener("focus", () => {
  activeCheck();
  sync();
});
window.addEventListener("online", sync);
window.addEventListener("storage", (e) => {
  if (!ready) return;
  if (e.key === progressKey || e.key === feedbackKey) sync();
});
window.addEventListener("beforeunload", (e) => {
  if (generation > ack) {
    cache();
    e.preventDefault();
    e.returnValue = "";
  }
});
document.addEventListener("keydown", (e) => {
  if (!ready) return;
  if (e.key === "Escape") {
    if ($("more").open) {
      $("more").open = false;
      $("more").querySelector("summary").focus();
    } else if (!$("comments").hidden) {
      closeEditor();
      sidebar(false);
      $("comments-toggle").focus();
    }
    return;
  }
  if (
    e.ctrlKey ||
    e.altKey ||
    e.metaKey ||
    e.target.closest("input,textarea,select,[contenteditable],.viewport")
  )
    return;
  if (e.key === "ArrowRight" && step()) {
    e.preventDefault();
    go(index + 1);
  }
  if (e.key === "ArrowLeft" && index > 0) {
    e.preventDefault();
    go(index - 1);
  }
});
new ResizeObserver(() => {
  if (ready) renderZoom();
}).observe($("comparison"));
window.addEventListener("resize", () => {
  if (ready) renderZoom();
});
init();
