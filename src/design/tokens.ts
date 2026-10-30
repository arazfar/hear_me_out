/** Velvet Verdict: the single source for DOM, scene, and identity assets. */
export const colors = {
  canvas: "#26131E",
  surface: "#40263B",
  cream: "#FFF3DF",
  seat0: "#A8D5F2",
  seat1: "#F7B38C",
  brass: "#D9B464",
  surfaceRaised: "#513449",
  surfaceHover: "#63465A",
  muted: "#D6BDCA",
  stroke: "#AA879B",
  actionHover: "#EBCB86",
  actionPressed: "#C9A153",
  field: "#FFF8EC",
  paperCopy: "#654354",
  fieldStroke: "#956B80",
  disabledFill: "#604858",
  disabledText: "#E3CED9",
  danger: "#FFB5B9",
  dangerInk: "#852E43",
  wood: "#A96E51",
  woodLight: "#D1A17A",
  woodDark: "#633A36",
  brassLight: "#F1D79C",
  brassDark: "#896329",
  velvetLight: "#6F465D",
  shadow: "#160B13",
} as const;
export const motion = {
  quick: 160,
  phase: 240,
  tally: 320,
  reward: 1200,
} as const;
export const materials = {
  painted: 0.58,
  velvet: 0.95,
  brass: 0.36,
  metalness: 0.22,
} as const;
export const lighting = {
  ambient: 0.8,
  hemisphere: 1.45,
  key: 2.6,
  rim: 1.2,
} as const;
export const tokens = {
  ...colors,
  "font-display": '"Lilita One", sans-serif',
  "font-body": '"Nunito Sans", sans-serif',
  "space-1": "4px",
  "space-2": "8px",
  "space-3": "12px",
  "space-4": "16px",
  "space-6": "24px",
  "space-8": "32px",
  "space-12": "48px",
  radius: "16px",
  "radius-small": "12px",
  shadow: `0 12px 30px ${colors.shadow}55`,
  "shadow-dialog": `0 20px 80px ${colors.shadow}99`,
  "shadow-button": `inset 0 -3px 0 ${colors.brassDark}55, 0 4px 10px ${colors.shadow}33`,
  "shadow-frame": `0 8px 24px ${colors.shadow}55`,
  backdrop: `${colors.canvas}df`,
  ease: "cubic-bezier(0.16, 1, 0.3, 1)",
  quick: `${motion.quick}ms`,
  phase: `${motion.phase}ms`,
} as const;
const kebab = (key: string) =>
  key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
export const tokenCSS = `:root {\n${Object.entries(tokens)
  .map(([key, value]) => `  --${kebab(key)}: ${value};`)
  .join("\n")}\n}`;
export const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="${colors.canvas}"/><g fill="${colors.brass}"><rect x="14" y="14" width="36" height="23" rx="10"/><rect x="28" y="34" width="8" height="18" rx="4"/></g><g fill="${colors.canvas}"><circle cx="25" cy="25" r="3"/><circle cx="39" cy="25" r="3"/></g><path d="M27 31q5 4 10 0" fill="none" stroke="${colors.canvas}" stroke-width="2" stroke-linecap="round"/></svg>`;
