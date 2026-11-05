type Point = readonly [number, number, number];
function box(min: Point, max: Point): Point[] {
  return [min[0], max[0]].flatMap((x) =>
    [min[1], max[1]].flatMap((y) =>
      [min[2], max[2]].map((z): Point => [x, y, z]),
    ),
  );
}
// Stable envelopes of Architecture(hero) and Bonk, including bevels and motion.
// Sample the circular platform rather than fitting empty corners of an 8×8 box.
export const HERO_BOUNDS: readonly Point[] = [
  ...[-0.04, 0.08].flatMap((y) =>
    Array.from({ length: 64 }, (_, i): Point => [
      4 * Math.cos((i * Math.PI) / 32),
      y,
      4 * Math.sin((i * Math.PI) / 32),
    ]),
  ),
  ...box([-1.82, 0, -1.5], [1.82, 3.75, -0.9]),
  ...box([-3.65, 0, -0.45], [-1.65, 1.4, 1.5]),
  ...box([1.65, 0, -0.45], [3.65, 1.4, 1.5]),
  ...box([-1.1, 0, -0.55], [1.1, 2.8, 1.15]),
];
export const HERO_TARGET: Point = [0, 1, 0];
export const HERO_DIRECTION: Point = [
  0,
  2 / Math.hypot(2, 8.4),
  8.4 / Math.hypot(2, 8.4),
];
/** Fit both axes with 8% of each viewport edge left clear. */
export function heroCameraPosition(
  aspect: number,
  fov = 38,
): [number, number, number] {
  const vertical = Math.tan((fov * Math.PI) / 360) * 0.84;
  const horizontal = vertical * Math.max(aspect, 0.01);
  const [, dy, dz] = HERO_DIRECTION;
  const distance = Math.max(
    ...HERO_BOUNDS.map(([x, y, z]) => {
      const relativeY = y - HERO_TARGET[1];
      const depth = relativeY * dy + z * dz;
      const height = relativeY * dz - z * dy;
      return (
        depth + Math.max(Math.abs(x) / horizontal, Math.abs(height) / vertical)
      );
    }),
  );
  return [0, HERO_TARGET[1] + dy * distance, dz * distance];
}
