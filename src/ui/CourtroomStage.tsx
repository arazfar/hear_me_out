import { colors as palette, materials, lighting } from "../design/tokens";
import { playerSeat } from "./identity";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { judgeIsListening, type Snapshot } from "../../shared/domain";
import { client } from "../game/client";

type Vec = [number, number, number];

function Block({
  at,
  size,
  color,
  radius = 0.08,
  rotation,
}: {
  at: Vec;
  size: Vec;
  color: string;
  radius?: number;
  rotation?: Vec;
}) {
  const [w, h, d] = size;
  const geometry = useMemo(
    () =>
      new RoundedBoxGeometry(w, h, d, 3, Math.min(radius, w / 3, h / 3, d / 3)),
    [w, h, d, radius],
  );
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh
      position={at}
      rotation={rotation}
      geometry={geometry}
      castShadow
      receiveShadow
    >
      <meshStandardMaterial color={color} roughness={materials.painted} />
    </mesh>
  );
}
function Bonk({
  state,
  reduced,
}: {
  state: Snapshot | null;
  reduced: boolean;
}) {
  const body = useRef<THREE.Group>(null!),
    pupils = useRef<THREE.Group>(null!),
    brow = useRef<THREE.Group>(null!),
    mouth = useRef<THREE.Mesh>(null!),
    smile = useRef<THREE.Mesh>(null!);
  const time = useRef(0),
    strike = useRef(-100);
  useEffect(() => {
    return client.on(({ feedback, feedbackReset }) => {
      if (feedbackReset) strike.current = -100;
      if (feedback?.kind === "round" || feedback?.kind === "match")
        strike.current = time.current;
    });
  }, []);
  useFrame((_, delta) => {
    time.current += Math.min(delta, 0.05);
    const t = time.current;
    const listening = judgeIsListening(state, state?.turn?.playerId || null);
    const target = listening
      ? state?.turn?.playerId
      : state?.judge?.status === "speaking"
        ? state.judge.targetPlayerId
        : null;
    const index = state
      ? playerSeat(
          state,
          state.players.find((p) => p.id === target),
        )
      : undefined;
    const look = index === 0 ? -0.2 : index === 1 ? 0.2 : 0;
    const talking =
      state?.judge?.status === "speaking" &&
      client.playback.rendering &&
      !client.sound.judgeMuted;
    const amplitude = talking ? client.sound.judgeAmplitude() : 0;
    const since = t - strike.current;
    const bonk =
      !reduced && since >= 0 && since < 1.2
        ? Math.sin(Math.min(1, since / 0.45) * Math.PI)
        : 0;
    body.current.rotation.y = reduced
      ? look
      : THREE.MathUtils.damp(body.current.rotation.y, look, 5, delta);
    body.current.rotation.z = reduced
      ? 0
      : Math.sin(t * 1.4) * 0.02 + bonk * 0.4;
    body.current.position.y =
      1.88 + (reduced ? 0 : Math.sin(t * 1.6) * 0.025 - bonk * 0.13);
    pupils.current.position.x = reduced
      ? look * 0.16
      : THREE.MathUtils.damp(pupils.current.position.x, look * 0.16, 6, delta);
    const blink = !reduced && t % 5.7 > 5.55;
    pupils.current.scale.y = THREE.MathUtils.damp(
      pupils.current.scale.y,
      blink ? 0.06 : 1,
      30,
      delta,
    );
    brow.current.rotation.z = THREE.MathUtils.damp(
      brow.current.rotation.z,
      state?.judge?.status === "buffering" || state?.judgePending
        ? -0.12
        : state?.judge?.expression === "smug"
          ? 0.1
          : 0,
      5,
      delta,
    );
    mouth.current.scale.y = THREE.MathUtils.damp(
      mouth.current.scale.y,
      talking ? 0.015 + amplitude * 0.8 : 0.01,
      18,
      delta,
    );
    mouth.current.visible = talking;
    smile.current.visible = !talking;
  });
  return (
    <group ref={body} position={[0, 1.88, 0.35]}>
      <mesh position={[0, -0.65, 0]} rotation={[0, 0, -0.08]} castShadow>
        <capsuleGeometry args={[0.15, 0.73, 8, 16]} />
        <meshStandardMaterial color={palette.wood} roughness={0.38} />
      </mesh>
      <mesh position={[0, -0.41, 0]} castShadow>
        <torusGeometry args={[0.17, 0.045, 8, 24]} />
        <meshStandardMaterial color={palette.woodDark} roughness={0.65} />
      </mesh>
      <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
        <capsuleGeometry args={[0.43, 0.7, 12, 32]} />
        <meshStandardMaterial
          color={palette.brass}
          roughness={materials.brass}
          metalness={materials.metalness}
        />
      </mesh>
      {[-0.72, 0.72].map((x) => (
        <group key={x} position={[x, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
          <mesh castShadow>
            <cylinderGeometry args={[0.46, 0.46, 0.16, 32]} />
            <meshStandardMaterial color={palette.brassDark} roughness={0.32} />
          </mesh>
          <mesh position={[0, x < 0 ? 0.09 : -0.09, 0]}>
            <cylinderGeometry args={[0.37, 0.37, 0.03, 32]} />
            <meshStandardMaterial color={palette.brassLight} roughness={0.4} />
          </mesh>
        </group>
      ))}
      <group ref={pupils}>
        {[-0.23, 0.23].map((x) => (
          <group key={x} position={[x, 0.05, 0.398]}>
            <mesh scale={[0.14, 0.18, 0.065]}>
              <sphereGeometry args={[1, 20, 16]} />
              <meshStandardMaterial color={palette.cream} roughness={0.45} />
            </mesh>
            <mesh
              position={[0.015, -0.012, 0.06]}
              scale={[0.077, 0.113, 0.035]}
            >
              <sphereGeometry args={[1, 16, 12]} />
              <meshStandardMaterial color={palette.canvas} roughness={0.25} />
            </mesh>
            <mesh
              position={[-0.005, 0.035, 0.088]}
              scale={[0.026, 0.035, 0.012]}
            >
              <sphereGeometry args={[1, 12, 8]} />
              <meshBasicMaterial color={palette.cream} />
            </mesh>
          </group>
        ))}
      </group>
      <group ref={brow}>
        {[-0.23, 0.23].map((x, i) => (
          <Block
            key={x}
            at={[x, 0.31, 0.4]}
            size={[0.27, 0.064, 0.075]}
            color={palette.canvas}
            radius={0.022}
            rotation={[0, 0, i ? 0.15 : -0.15]}
          />
        ))}
      </group>
      <mesh
        ref={mouth}
        position={[0, -0.17, 0.436]}
        scale={[0.115, 0.01, 0.027]}
      >
        <sphereGeometry args={[1, 16, 12]} />
        <meshStandardMaterial color={palette.canvas} />
      </mesh>
      <mesh ref={smile} position={[0, -0.13, 0.437]} rotation={[0, 0, Math.PI]}>
        <torusGeometry args={[0.115, 0.023, 8, 20, Math.PI]} />
        <meshStandardMaterial color={palette.canvas} />
      </mesh>
      {[-0.38, 0.38].map((x) => (
        <mesh key={x} position={[x, -0.14, 0.355]} scale={[0.085, 0.037, 0.03]}>
          <sphereGeometry args={[1, 12, 8]} />
          <meshStandardMaterial color={palette.seat1} roughness={0.8} />
        </mesh>
      ))}
      {[-2, -1, 0, 1, 2].map((n) => (
        <mesh
          key={n}
          position={[n * 0.16, 0.43 + (1 - Math.abs(n) / 3) * 0.09, -0.04]}
          scale={[0.16, 0.13, 0.24]}
          castShadow
        >
          <sphereGeometry args={[1, 16, 12]} />
          <meshStandardMaterial color={palette.cream} roughness={0.78} />
        </mesh>
      ))}
      {[-1, 1].flatMap((side) =>
        [0, 1, 2].map((n) => (
          <mesh
            key={side + ":" + n}
            position={[side * (0.45 + n * 0.03), 0.32 - n * 0.15, -0.045]}
            rotation={[Math.PI / 2, 0, 0]}
            castShadow
          >
            <torusGeometry args={[0.086, 0.051, 8, 16]} />
            <meshStandardMaterial color={palette.cream} roughness={0.75} />
          </mesh>
        )),
      )}
    </group>
  );
}
function Architecture({ hero }: { hero: boolean }) {
  const arch = useMemo(() => {
    const s = new THREE.Shape();
    s.moveTo(-1.65, 0);
    s.lineTo(1.65, 0);
    s.lineTo(1.65, 1.8);
    s.absarc(0, 1.8, 1.65, 0, Math.PI, false);
    s.lineTo(-1.65, 0);
    return new THREE.ExtrudeGeometry(s, {
      depth: 0.12,
      bevelEnabled: true,
      bevelThickness: 0.06,
      bevelSize: 0.06,
      bevelSegments: 3,
      steps: 1,
      curveSegments: 32,
    });
  }, []);
  useEffect(() => () => arch.dispose(), [arch]);
  return (
    <>
      <mesh geometry={arch} position={[0, 0.12, -1.3]} receiveShadow>
        <meshStandardMaterial
          color={palette.surface}
          roughness={materials.velvet}
        />
      </mesh>
      <mesh position={[0, 1.92, -1.14]} castShadow>
        <torusGeometry args={[1.64, 0.105, 10, 48, Math.PI]} />
        <meshStandardMaterial color={palette.brass} roughness={0.7} />
      </mesh>
      {[-1.64, 1.64].map((x) => (
        <group key={x}>
          <Block
            at={[x, 1, -1.14]}
            size={[0.21, 1.83, 0.24]}
            color={palette.brass}
          />
          <Block
            at={[x, 0.2, -1.08]}
            size={[0.4, 0.25, 0.4]}
            color={palette.cream}
          />
        </group>
      ))}
      <mesh position={[0, 0.02, 0]} receiveShadow>
        <cylinderGeometry
          args={[hero ? 3.45 : 2.1, hero ? 3.45 : 2.1, 0.12, 64]}
        />
        <meshStandardMaterial color={palette.surfaceRaised} roughness={0.8} />
      </mesh>
      <Block
        at={[0, 0.4, 0.05]}
        size={[1.85, 0.64, 0.9]}
        color={palette.woodDark}
        radius={0.1}
      />
      <Block
        at={[0, 0.78, 0.07]}
        size={[2.13, 0.2, 1.12]}
        color={palette.woodLight}
      />
      <Block
        at={[0, 0.35, 0.53]}
        size={[1.4, 0.32, 0.04]}
        color={palette.canvas}
        radius={0.03}
      />
      <Block
        at={[0, 0.39, 0.565]}
        size={[0.66, 0.22, 0.04]}
        color={palette.brass}
        radius={0.03}
      />
      <mesh position={[0, 0.89, 0.16]} castShadow>
        <cylinderGeometry args={[0.33, 0.38, 0.08, 32]} />
        <meshStandardMaterial color={palette.woodDark} roughness={0.45} />
      </mesh>
      {[-1.3, 1.3].map((x) => (
        <group key={x}>
          <Block
            at={[x, 0.45, -0.7]}
            size={[0.19, 0.7, 0.19]}
            color={palette.woodLight}
          />
          <mesh position={[x, 0.87, -0.7]}>
            <sphereGeometry args={[0.15, 16, 12]} />
            <meshStandardMaterial
              color={palette.cream}
              emissive={palette.brassLight}
              emissiveIntensity={0.35}
              roughness={0.4}
            />
          </mesh>
        </group>
      ))}
      {hero &&
        [-2.65, 2.65].map((x, i) => (
          <group key={x} rotation={[0, x < 0 ? 0.12 : -0.12, 0]}>
            <Block
              at={[x, 0.6, 0.35]}
              size={[1.45, 1.1, 1.05]}
              color={i ? palette.seat1 : palette.seat0}
              radius={0.15}
            />
            <Block
              at={[x, 1.22, 0.36]}
              size={[1.65, 0.2, 1.2]}
              color={palette.cream}
            />
            <Block
              at={[x, 0.62, 0.9]}
              size={[0.87, 0.6, 0.035]}
              color={palette.canvas}
              radius={0.012}
            />
            <mesh position={[x, 0.63, 0.94]} rotation={[0, 0, Math.PI]}>
              <torusGeometry args={[0.2, 0.04, 8, 24, Math.PI]} />
              <meshStandardMaterial color={i ? palette.seat1 : palette.seat0} />
            </mesh>
          </group>
        ))}
      {[-1, 1].map((side) => (
        <group
          key={side}
          position={[side * 0.68, 0.95, 0.18]}
          rotation={[0, 0, side * 0.05]}
        >
          <Block
            at={[0, 0, 0]}
            size={[0.34, 0.09, 0.34]}
            color={side < 0 ? palette.brass : palette.cream}
            radius={0.025}
          />
          <Block
            at={[0, 0.1, 0]}
            size={[0.31, 0.08, 0.3]}
            color={side < 0 ? palette.cream : palette.brass}
            radius={0.025}
          />
        </group>
      ))}
    </>
  );
}
function Scene({
  state,
  reduced,
  hero,
  onSlow,
  onLost,
}: {
  state: Snapshot | null;
  reduced: boolean;
  hero: boolean;
  onSlow: () => void;
  onLost: () => void;
}) {
  const { camera, gl, invalidate } = useThree();
  const elapsed = useRef(0),
    slow = useRef(0);
  useEffect(() => {
    camera.position.set(0, hero ? 3.15 : 2.7, hero ? 8.4 : 5.8);
    camera.lookAt(0, hero ? 1.15 : 1.75, 0);
    const lost = (e: Event) => {
      e.preventDefault();
      onLost();
    };
    gl.domElement.addEventListener("webglcontextlost", lost);
    return () => gl.domElement.removeEventListener("webglcontextlost", lost);
  }, [camera, gl, hero, onLost]);
  useFrame((_, delta) => {
    elapsed.current += delta;
    if (elapsed.current > 3 && document.visibilityState === "visible") {
      slow.current =
        delta > 0.035
          ? slow.current + Math.min(delta, 0.1)
          : Math.max(0, slow.current - delta);
      if (slow.current > 2) {
        onSlow();
        slow.current = 0;
      }
    }
    if (reduced) invalidate();
  });
  return (
    <>
      <ambientLight intensity={lighting.ambient} />
      <hemisphereLight
        args={[palette.cream, palette.canvas, lighting.hemisphere]}
      />
      <directionalLight
        position={[-3, 6, 6]}
        intensity={lighting.key}
        color={palette.cream}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-5}
        shadow-camera-right={5}
        shadow-camera-top={5}
        shadow-camera-bottom={-5}
        shadow-bias={-0.0005}
      />
      <directionalLight
        position={[3, 2, -2]}
        intensity={lighting.rim}
        color={palette.brassLight}
      />
      <pointLight
        position={[-3, 2, 2]}
        intensity={
          !!state?.turn &&
          playerSeat(
            state,
            state.players.find((p) => p.id === state.turn?.playerId),
          ) === 0
            ? 9
            : 4
        }
        color={palette.seat0}
        distance={8}
      />
      <pointLight
        position={[3, 2, 2]}
        intensity={
          !!state?.turn &&
          playerSeat(
            state,
            state.players.find((p) => p.id === state.turn?.playerId),
          ) === 1
            ? 9
            : 4
        }
        color={palette.seat1}
        distance={8}
      />
      <Architecture hero={hero} />
      <Bonk state={state} reduced={reduced} />
    </>
  );
}
const CourtroomStage = memo(function CourtroomStage({
  state,
  reduced,
  hero = false,
  onLost,
}: {
  state: Snapshot | null;
  reduced: boolean;
  hero?: boolean;
  onLost: () => void;
}) {
  const [low, setLow] = useState(false);
  return (
    <div
      className="stage"
      aria-hidden="true"
      data-quality={low ? "low" : "normal"}
    >
      <Canvas
        resize={{ offsetSize: true }}
        camera={{ position: [0, 2.5, 5.3], fov: 38 }}
        dpr={low ? 1 : [1, 1.5]}
        shadows={low ? false : "percentage"}
        gl={{ antialias: true, alpha: true, powerPreference: "default" }}
        onCreated={({ gl }) => gl.setClearColor(palette.canvas, 0)}
      >
        <Scene
          state={state}
          reduced={reduced}
          hero={hero}
          onSlow={() => setLow(true)}
          onLost={onLost}
        />
      </Canvas>
    </div>
  );
});
export default CourtroomStage;
