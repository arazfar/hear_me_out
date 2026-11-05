export const FLOWS = [
  "Entry & setup",
  "Lobby",
  "Coin & topics",
  "Gameplay",
  "Results",
  "Recovery",
  "Shared UI",
];
export const SIZES = ["desktop", "phone"];
export function catalog(manifest) {
  const scenarios = FLOWS.flatMap((group) => {
    const list = manifest.scenarios.filter((s) => s.group === group);
    if (group !== "Results") return list;
    const order = [
      "round-verdict",
      "tie-break",
      "winner",
      "match-draw",
      "draw-captions",
      "rematch-wait",
      "rematch-queued",
      "rematch-pending",
      "result-repair",
      "departed",
    ];
    return list.sort(
      (a, b) =>
        (order.indexOf(a.id) < 0 ? 99 : order.indexOf(a.id)) -
        (order.indexOf(b.id) < 0 ? 99 : order.indexOf(b.id)),
    );
  });
  if (scenarios.length !== manifest.scenarios.length)
    throw Error("Unknown flow in review manifest");
  const captures = new Map(manifest.captures.map((c) => [c.id, c]));
  const frames = (id, size, version) =>
    manifest.captures
      .filter(
        (c) =>
          c.scenario === id && c.viewport === size && c.version === version,
      )
      .sort((a, b) => a.frame - b.frame);
  const steps = scenarios.flatMap((s) =>
    SIZES.flatMap((size) => {
      const before = frames(s.id, size, "before"),
        after = frames(s.id, size, "after");
      if (!before.length || !after.length)
        throw Error("Missing comparison: " + s.id);
      return Array.from(
        { length: Math.max(before.length, after.length) },
        (_, frame) => ({
          scenario: s.id,
          group: s.group,
          viewport: size,
          frame,
          before: before[Math.min(frame, before.length - 1)],
          after: after[Math.min(frame, after.length - 1)],
          total: Math.max(before.length, after.length),
        }),
      );
    }),
  );
  return { scenarios, captures, frames, steps };
}
export function mergeFeedback(a, b) {
  const comments = new Map(a.comments.map((c) => [c.id, c]));
  for (const c of b.comments || [])
    if (!comments.has(c.id) || c.updatedAt > comments.get(c.id).updatedAt)
      comments.set(c.id, c);
  const reviewed = { ...a.reviewed };
  for (const [k, v] of Object.entries(b.reviewed || {}))
    if (!reviewed[k] || v.updatedAt > reviewed[k].updatedAt) reviewed[k] = v;
  return { ...a, comments: [...comments.values()], reviewed };
}
export function completeView(model, feedback, viewed, id, size) {
  return (
    feedback.reviewed?.[id + ":" + size]?.value === true ||
    ["before", "after"].every((v) =>
      model.frames(id, size, v).every((c) => viewed.has(c.id)),
    )
  );
}
export function completeState(model, feedback, viewed, id) {
  return SIZES.every((size) => completeView(model, feedback, viewed, id, size));
}
export function unseenStep(model, feedback, viewed) {
  return model.steps.findIndex(
    (s) =>
      !completeView(model, feedback, viewed, s.scenario, s.viewport) &&
      [s.before, s.after].some((c) => !viewed.has(c.id)),
  );
}
export function locate(model, hash) {
  const p = new URLSearchParams(hash.replace(/^#/, ""));
  if (p.get("end") === "1") return model.steps.length;
  const id = p.get("screen"),
    size = p.get("viewport") === "phone" ? "phone" : "desktop",
    frame = Math.max(0, Number(p.get("frame")) || 0);
  const candidates = model.steps
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s.scenario === id && s.viewport === size);
  return candidates.length
    ? candidates[Math.min(frame, candidates.length - 1)].i
    : -1;
}
export function markdown(manifest, data, progress) {
  const viewed = new Set(progress.viewedCaptureIds || []),
    model = catalog(manifest);
  const completed = model.scenarios.filter((s) =>
    completeState(model, data, viewed, s.id),
  ).length;
  return (
    `# Hear Me Out UI review\n\nReview: ${manifest.id}\n\n${completed}/${model.scenarios.length} states reviewed (viewed, not approved).${data.dirty ? " Includes unsaved browser drafts." : ""}\n\n` +
    data.comments
      .filter((c) => !c.deleted)
      .map(
        (c) =>
          `## ${c.number || "Draft"}. ${c.resolved ? "[Resolved] " : ""}${model.scenarios.find((s) => s.id === c.scenario)?.title || c.scenario}\n\n${c.viewport} · ${c.version} · frame ${c.frame + 1} · pin (${(c.x * 100).toFixed(2)}%, ${(c.y * 100).toFixed(2)}%)\n\nScreenshot: ${model.captures.get(c.captureId)?.file}\nSHA-256: ${model.captures.get(c.captureId)?.sha256}\n\n${c.text || "(Empty note)"}\n`,
      )
      .join("\n")
  );
}
