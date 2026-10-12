import type { CSSProperties } from "react";

export type IconName =
  | "mic"
  | "mic-off"
  | "camera"
  | "camera-off"
  | "volume"
  | "muted"
  | "arrow"
  | "copy"
  | "check"
  | "close"
  | "help"
  | "leave"
  | "gavel"
  | "clock"
  | "refresh"
  | "warning"
  | "chevron"
  | "headphones"
  | "coin"
  | "coin-tails"
  | "trophy";
const paths: Record<IconName, string> = {
  mic: "M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0V5ZM5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8",
  "mic-off":
    "m3 3 18 18M9 9v3a3 3 0 0 0 5 2M9 5a3 3 0 0 1 6 0v5M5 10v2a7 7 0 0 0 12 5M19 10v2M12 19v3M8 22h8",
  camera:
    "M4 5h11a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2ZM17 9l5-3v12l-5-3",
  "camera-off":
    "m2 2 20 20M6 5h9a2 2 0 0 1 2 2v5M17 9l5-3v12l-2-1M2 7v10a2 2 0 0 0 2 2h11",
  volume: "M11 3 5 8H2v8h3l6 5V3ZM15 8a6 6 0 0 1 0 8M18 4a11 11 0 0 1 0 16",
  muted: "M11 3 5 8H2v8h3l6 5V3Zm5 6 6 6m0-6-6 6",
  arrow: "M4 12h15m-6-6 6 6-6 6",
  copy: "M9 8h10v13H9zM15 8V3H4v13h5",
  check: "m5 12 4 4L19 6",
  close: "m6 6 12 12M6 18 18 6",
  help: "M9 8a3 3 0 1 1 4 3c-1 .5-1 1-1 3M12 18h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z",
  leave: "M9 4H3v16h6M9 12h12m-4-4 4 4-4 4",
  gavel: "m7 3 8 8-4 4-8-8 4-4Zm6 10 7 7M4 21h9",
  clock: "M12 7v5l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z",
  refresh: "M20 8a9 9 0 1 0 1 8M20 3v5h-5",
  warning: "m12 3 10 18H2L12 3ZM12 9v5M12 18h.01",
  chevron: "m8 4 8 8-8 8",
  headphones: "M3 13v-1a9 9 0 0 1 18 0v1M3 12h3v8H3zM18 12h3v8h-3z",
  coin: "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0ZM9 8v8m6-8v8M9 12h6",
  "coin-tails": "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0ZM8 8h8m-4 0v8",
  trophy:
    "M7 3h10v7a5 5 0 0 1-10 0V3ZM7 5H3v3a4 4 0 0 0 4 4M17 5h4v3a4 4 0 0 1-4 4M12 15v6M7 21h10",
};
export function Icon({
  name,
  className = "",
  style,
}: {
  name: IconName;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      className={"icon " + className}
      style={style}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
