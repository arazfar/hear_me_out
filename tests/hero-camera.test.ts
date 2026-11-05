import { test } from "node:test";
import assert from "node:assert/strict";
import { PerspectiveCamera, Vector3 } from "three";
import {
  HERO_BOUNDS,
  HERO_TARGET,
  heroCameraPosition,
} from "../src/ui/hero-camera";

test("hero camera contains the architecture and animation envelope at every supported aspect", () => {
  for (const aspect of [0.75, 1, 1.3, 1.79, 2.4, 3.5]) {
    const camera = new PerspectiveCamera(38, aspect, 0.1, 100);
    camera.position.set(...heroCameraPosition(aspect));
    camera.lookAt(...HERO_TARGET);
    camera.updateMatrixWorld();
    const projections = HERO_BOUNDS.map((p) =>
      new Vector3(...p).project(camera),
    );
    for (const p of projections) {
      assert.ok(
        Math.abs(p.x) <= 0.840001 && Math.abs(p.y) <= 0.840001,
        `clipped at aspect ${aspect}`,
      );
      assert.ok(p.z > -1 && p.z < 1);
    }
    // A fitted scene should also use the available space, not vanish into it.
    assert.ok(
      Math.max(...projections.flatMap((p) => [Math.abs(p.x), Math.abs(p.y)])) >
        0.83,
    );
  }
});
