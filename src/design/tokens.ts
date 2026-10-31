/** Tangerine Arcade: semantic roles shared by CSS, React, Three.js and assets. */
const pigment = {
  midnight: "#151E32",
  slate: "#24314B",
  raised: "#2F3F5C",
  hover: "#3B4E6B",
  ice: "#F6F8FF",
  mist: "#BFCBE0",
  border: "#8B9DB9",
  input: "#19263D",
  turquoise: "#55D6CB",
  turquoiseTint: "#173F45",
  lilac: "#C3A4FF",
  lilacTint: "#3B3157",
  tangerine: "#FFAF45",
  actionHover: "#FFC36E",
  actionPressed: "#E99728",
  disabledFill: "#33425B",
  disabledText: "#B5C2D8",
  success: "#A0E6B6",
  successSurface: "#173F32",
  warning: "#FFD17A",
  warningSurface: "#493719",
  error: "#FFADB9",
  errorSurface: "#4B2636",
  highlight: "#FFD59C",
  shade: "#B86D15",
  furniture: "#344762",
} as const;

export const theme = {
  surface: {
    canvas: pigment.midnight,
    panel: pigment.slate,
    raised: pigment.raised,
    hover: pigment.hover,
    input: pigment.input,
    media: pigment.midnight,
    inverse: pigment.ice,
  },
  text: {
    primary: pigment.ice,
    secondary: pigment.mist,
    accent: pigment.tangerine,
    onAccent: pigment.midnight,
    inverse: pigment.midnight,
    placeholder: pigment.mist,
  },
  border: {
    control: pigment.border,
    focus: pigment.ice,
    focusGap: pigment.midnight,
  },
  action: {
    primary: pigment.tangerine,
    hover: pigment.actionHover,
    pressed: pigment.actionPressed,
    text: pigment.midnight,
  },
  identity: {
    seat0: {
      base: pigment.turquoise,
      tint: pigment.turquoiseTint,
      onBase: pigment.midnight,
    },
    seat1: {
      base: pigment.lilac,
      tint: pigment.lilacTint,
      onBase: pigment.midnight,
    },
  },
  status: {
    success: { text: pigment.success, surface: pigment.successSurface },
    warning: { text: pigment.warning, surface: pigment.warningSurface },
    error: { text: pigment.error, surface: pigment.errorSurface },
    privacy: { text: pigment.mist, surface: pigment.input },
    disabled: { text: pigment.disabledText, surface: pigment.disabledFill },
  },
  scene: {
    canvas: pigment.midnight,
    backdrop: pigment.slate,
    floor: pigment.raised,
    furniture: pigment.furniture,
    furnitureTop: pigment.hover,
    furnitureInset: pigment.midnight,
    bonk: {
      body: pigment.tangerine,
      highlight: pigment.highlight,
      shade: pigment.shade,
      features: pigment.midnight,
      robe: pigment.midnight,
      wig: pigment.ice,
      cheek: pigment.actionPressed,
    },
    accent: pigment.tangerine,
    lightPaint: pigment.ice,
  },
  lighting: {
    key: pigment.ice,
    sky: pigment.ice,
    ground: pigment.midnight,
    rim: pigment.highlight,
  },
} as const;
export const motion = {
  quick: 160,
  phase: 240,
  tally: 320,
  reward: 1200,
} as const;
export const materials = {
  painted: 0.58,
  backdrop: 0.95,
  host: 0.65,
  metalness: 0,
} as const;
export const lighting = {
  ambient: 0.8,
  hemisphere: 1.45,
  key: 2.6,
  rim: 1.2,
} as const;

type TokenTree = { readonly [key: string]: string | TokenTree };
const kebab = (key: string) =>
  key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
function flatten(tree: TokenTree, prefix = ""): Record<string, string> {
  return Object.fromEntries(
    Object.entries(tree).flatMap(([key, value]) => {
      const name = prefix + kebab(key);
      return typeof value === "string"
        ? [[name, value]]
        : Object.entries(flatten(value, name + "-"));
    }),
  );
}
export const tokens = {
  ...flatten(theme),
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
  "shadow-color": pigment.midnight,
  shadow: `0 12px 30px ${pigment.midnight}55`,
  "shadow-dialog": `0 20px 80px ${pigment.midnight}99`,
  "shadow-button": `inset 0 -3px 0 ${pigment.shade}55, 0 4px 10px ${pigment.midnight}33`,
  "shadow-frame": `0 8px 24px ${pigment.midnight}55`,
  backdrop: `${pigment.midnight}df`,
  ease: "cubic-bezier(0.16, 1, 0.3, 1)",
  quick: `${motion.quick}ms`,
  phase: `${motion.phase}ms`,
} as const;
export const tokenCSS = `:root {\n${Object.entries(tokens)
  .map(([key, value]) => `  --${key}: ${value};`)
  .join("\n")}\n}`;
export const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="${theme.surface.canvas}"/><g fill="${theme.scene.bonk.body}"><rect x="14" y="14" width="36" height="23" rx="10"/><rect x="28" y="34" width="8" height="18" rx="4"/></g><g fill="${theme.scene.bonk.features}"><circle cx="25" cy="25" r="3"/><circle cx="39" cy="25" r="3"/></g><path d="M27 31q5 4 10 0" fill="none" stroke="${theme.scene.bonk.features}" stroke-width="2" stroke-linecap="round"/></svg>`;
