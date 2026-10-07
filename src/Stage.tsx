import { Canvas, useFrame } from "@react-three/fiber";
import { memo, useRef, useState } from "react";
import * as THREE from "three";
import type { Snapshot } from "../shared/types";
import { client } from "./client";
function Box({
  position,
  scale,
  color,
  rotation = [0, 0, 0],
}: {
  position: [number, number, number];
  scale: [number, number, number];
  color: string;
  rotation?: [number, number, number];
}) {
  return (
    <mesh
      position={position}
      scale={scale}
      rotation={rotation}
      castShadow
      receiveShadow
    >
      <boxGeometry />
      <meshStandardMaterial color={color} roughness={0.48} />
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
    mouth = useRef<THREE.Mesh>(null!),
    brow = useRef<THREE.Group>(null!);
  useFrame(({ clock }, delta) => {
    const t = clock.elapsedTime;
    const target =
      state?.judge?.status === "speaking" ? state.judge.targetPlayerId : null;
    const index = state?.players.findIndex(
      (p) => p.id === (target || state.turn?.playerId),
    );
    body.current.rotation.y = THREE.MathUtils.damp(
      body.current.rotation.y,
      index === 0 ? -0.22 : index === 1 ? 0.22 : 0,
      5,
      delta,
    );
    body.current.position.y = 1.42 + (reduced ? 0 : Math.sin(t * 1.7) * 0.045);
    const since =
      (Date.now() + client.offset - (state?.ledger.at(-1)?.at || 0)) / 1000;
    body.current.rotation.z = reduced
      ? 0
      : Math.sin(t * 1.4) * 0.025 +
        (since >= 0 && since < 0.5 ? Math.sin(since * Math.PI * 4) * 0.12 : 0);
    const talking = state?.judge?.status === "speaking";
    mouth.current.scale.y = THREE.MathUtils.damp(
      mouth.current.scale.y,
      talking ? 0.04 + client.judgeAmplitude() * 0.65 : 0.025,
      18,
      delta,
    );
    brow.current.rotation.z = THREE.MathUtils.damp(
      brow.current.rotation.z,
      state?.judgePending ? 0.1 : talking ? -0.08 : 0,
      5,
      delta,
    );
  });
  return (
    <group ref={body} position={[0, 1.42, 0]}>
      <mesh position={[0, -0.68, 0]} rotation={[0, 0, 0.08]} castShadow>
        <capsuleGeometry args={[0.16, 0.78, 8, 16]} />
        <meshStandardMaterial color="#C98242" roughness={0.4} />
      </mesh>
      <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
        <capsuleGeometry args={[0.44, 0.65, 12, 24]} />
        <meshStandardMaterial color="#B6A0E8" roughness={0.35} />
      </mesh>
      {[-0.64, 0.64].map((x) => (
        <mesh
          key={x}
          position={[x, 0, 0]}
          rotation={[0, 0, Math.PI / 2]}
          castShadow
        >
          <cylinderGeometry args={[0.45, 0.45, 0.12, 24]} />
          <meshStandardMaterial color="#D8FF3E" roughness={0.38} />
        </mesh>
      ))}
      {[-0.25, 0.25].map((x, i) => (
        <group key={x} position={[x, 0.05, 0.407]}>
          <mesh scale={[0.1, 0.13, 0.055]}>
            <sphereGeometry args={[1, 16, 12]} />
            <meshStandardMaterial color="#20102E" />
          </mesh>
          <mesh position={[-0.022, 0.035, 0.046]} scale={[0.025, 0.035, 0.015]}>
            <sphereGeometry args={[1, 12, 8]} />
            <meshBasicMaterial color="#FFF0CE" />
          </mesh>
        </group>
      ))}
      <group ref={brow}>
        {[-0.25, 0.25].map((x, i) => (
          <Box
            key={x}
            position={[x, 0.27, 0.4]}
            scale={[0.25, 0.045, 0.065]}
            color="#20102E"
            rotation={[0, 0, i ? -0.2 : 0.2]}
          />
        ))}
      </group>
      <mesh
        ref={mouth}
        position={[0, -0.16, 0.438]}
        scale={[0.16, 0.22, 0.045]}
      >
        <sphereGeometry args={[1, 20, 12]} />
        <meshStandardMaterial color="#20102E" />
      </mesh>
      <mesh position={[0, 0.48, -0.01]} castShadow>
        <cylinderGeometry args={[0.27, 0.35, 0.12, 24]} />
        <meshStandardMaterial color="#FFF0CE" />
      </mesh>
    </group>
  );
}
function Set({
  state,
  reduced,
  onSlow,
}: {
  state: Snapshot | null;
  reduced: boolean;
  onSlow: () => void;
}) {
  const coin = useRef<THREE.Mesh>(null!);
  const slow = useRef(0);
  useFrame((_, delta) => {
    if (delta > 0.022) slow.current++;
    else slow.current = Math.max(0, slow.current - 1);
    if (slow.current > 100) {
      onSlow();
      slow.current = 0;
    }
    if (coin.current) {
      coin.current.visible = state?.phase === "INTRO_COIN";
      if (!reduced) coin.current.rotation.z += delta * 9;
    }
  });
  return (
    <>
      <ambientLight intensity={1.2} />
      <hemisphereLight args={["#FFF0CE", "#20102E", 1.6]} />
      <directionalLight
        position={[-3, 6, 5]}
        intensity={3}
        color="#FFF0CE"
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-5}
        shadow-camera-right={5}
        shadow-camera-top={5}
        shadow-camera-bottom={-5}
      />
      <pointLight
        position={[-4, 2, 2]}
        intensity={state?.turn?.playerId === state?.players[0]?.id ? 25 : 12}
        color="#FF4F9A"
      />
      <pointLight
        position={[4, 2, 2]}
        intensity={state?.turn?.playerId === state?.players[1]?.id ? 25 : 12}
        color="#39D8F2"
      />
      <mesh position={[0, -0.15, 0]} receiveShadow>
        <cylinderGeometry args={[5.5, 5.5, 0.2, 64]} />
        <meshStandardMaterial color="#513163" roughness={0.8} />
      </mesh>
      <mesh position={[0, -0.18, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <torusGeometry args={[5.45, 0.08, 8, 64]} />
        <meshStandardMaterial color="#FF4F9A" />
      </mesh>
      {[-1, 0, 1].flatMap((x) =>
        [-1, 0, 1].map((z) => (
          <Box
            key={`${x}${z}`}
            position={[x * 1.25, -0.015, z * 1.25]}
            scale={[1.18, 0.015, 1.18]}
            color={(x + z) % 2 ? "#6D4C7C" : "#8C6D95"}
          />
        )),
      )}
      {[-2.45, 2.45].map((x, i) => (
        <group key={x} position={[x, 0, 0.7]}>
          <Box
            position={[0, 0.6, 0]}
            scale={[1.5, 1.2, 0.95]}
            color={i ? "#39D8F2" : "#FF4F9A"}
          />
          <Box
            position={[0, 1.22, 0]}
            scale={[1.72, 0.16, 1.12]}
            color="#FFF0CE"
          />
          <Box
            position={[0, 0.58, 0.49]}
            scale={[0.92, 0.65, 0.025]}
            color="#20102E"
          />
          <mesh position={[0, 0.55, 0.525]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.2, 0.035, 8, 24]} />
            <meshStandardMaterial color="#D8FF3E" />
          </mesh>
        </group>
      ))}
      <Box position={[0, 0.22, -0.25]} scale={[1.5, 0.45, 1]} color="#C98242" />
      <Box
        position={[0, 0.46, -0.25]}
        scale={[1.65, 0.12, 1.2]}
        color="#FFF0CE"
      />
      <Bonk state={state} reduced={reduced} />
      {[-4.5, 4.5].map((x) => (
        <group key={x}>
          <Box
            position={[x, 1, -1.7]}
            scale={[0.35, 2, 0.35]}
            color="#C98242"
          />
          <mesh position={[x, 2.2, -1.7]}>
            <sphereGeometry args={[0.3, 16, 12]} />
            <meshStandardMaterial
              color="#D8FF3E"
              emissive="#D8FF3E"
              emissiveIntensity={0.2}
            />
          </mesh>
        </group>
      ))}
      <mesh
        ref={coin}
        position={[0, 3.4, 0.4]}
        rotation={[Math.PI / 2, 0, 0]}
        castShadow
      >
        <cylinderGeometry args={[0.46, 0.46, 0.09, 32]} />
        <meshStandardMaterial
          color="#D8FF3E"
          metalness={0.6}
          roughness={0.25}
        />
      </mesh>
    </>
  );
}
export const Stage = memo(function Stage({
  state,
  reduced,
}: {
  state: Snapshot | null;
  reduced: boolean;
}) {
  const [low, setLow] = useState(false);
  return (
    <div className="stage" aria-hidden="true">
      <Canvas
        camera={{ position: [0, 4.1, 8.8], fov: 40 }}
        dpr={low ? 1 : [1, 1.5]}
        shadows={!low}
        gl={{ antialias: true, alpha: true }}
        onCreated={({ camera, gl }) => {
          camera.lookAt(0, 1, 0);
          gl.setClearColor(0x20102e, 0);
        }}
      >
        <Set state={state} reduced={reduced} onSlow={() => setLow(true)} />
      </Canvas>
    </div>
  );
});
