import { useLayoutEffect, useMemo, useRef } from "react";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import type { Square } from "chess.js";
import { pieceGeometry, type PieceType } from "./pieces";
import { pieceMaterial } from "./materials";
import { SETTLE, type Impact, type Motion, type Pose, type Token } from "./tokens";

const MATERIALS = { w: pieceMaterial("w"), b: pieceMaterial("b") };

const clock = () => {
  if (import.meta.env.DEV) {
    const frozen = (window as unknown as { __time3d?: number }).__time3d;
    if (frozen !== undefined) return frozen;
  }
  return performance.now() / 1000;
};
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function shortAngle(from: number, to: number) {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

type Live = {
  motion: Motion | null;
  from: Pose;
  placed: boolean;
  lift: number;
};

export function PieceToken({
  token,
  target,
  lifted,
  onPick,
}: {
  token: Token;
  target: Pose;
  lifted: boolean;
  onPick: (sq: Square, e: ThreeEvent<MouseEvent>) => void;
}) {
  const group = useRef<THREE.Group>(null!);
  const body = useRef<THREE.Mesh>(null!);
  const invalidate = useThree((s) => s.invalidate);
  const live = useRef<Live>({ motion: null, from: { x: 0, y: 0, z: 0, yaw: 0 }, placed: false, lift: 0 });

  useLayoutEffect(() => {
    const s = live.current;
    const g = group.current;
    if (!s.placed) {
      s.placed = true;
      if (token.motion?.kind === "spawn") {
        s.from = { ...target, y: target.y + 2.5 };
        s.motion = token.motion;
        g.position.set(s.from.x, s.from.y, s.from.z);
      } else {
        g.position.set(target.x, target.y, target.z);
      }
      g.rotation.set(0, target.yaw, 0);
    } else if (token.motion && token.motion !== s.motion) {
      s.from = { x: g.position.x, y: g.position.y, z: g.position.z, yaw: g.rotation.y };
      s.motion = token.motion;
    }
    invalidate();
  }, [token.motion, target, invalidate]);

  useFrame(() => {
    const s = live.current;
    const g = group.current;
    const now = clock();
    let busy = false;

    if (s.motion) {
      const m = s.motion;
      const t = (now - m.startAt) / m.duration;
      if (t < 0) {
        busy = true;
      } else if (now < m.startAt + m.duration + SETTLE) {
        busy = true;
        fly(g, body.current, s.from, target, m, Math.min(1, t), Math.max(0, now - m.startAt - m.duration));
      } else {
        g.position.set(target.x, target.y, target.z);
        g.rotation.set(0, target.yaw, 0);
        body.current.scale.set(1, 1, 1);
        s.motion = null;
      }
    } else {
      const dx = target.x - g.position.x;
      const dy = target.y - g.position.y;
      const dz = target.z - g.position.z;
      const dyaw = shortAngle(g.rotation.y, target.yaw);
      if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) + Math.abs(dyaw) > 0.0005) {
        g.position.x += dx * 0.18;
        g.position.y += dy * 0.18;
        g.position.z += dz * 0.18;
        g.rotation.y += dyaw * 0.18;
        busy = true;
      }
    }

    const want = lifted ? 0.18 : 0;
    s.lift += (want - s.lift) * 0.22;
    if (Math.abs(want - s.lift) > 0.001) busy = true;
    const bob = lifted ? Math.sin(now * 3.2) * 0.018 : 0;
    if (lifted) busy = true;
    body.current.position.y = s.lift + bob;
    body.current.rotation.y = lifted ? Math.sin(now * 1.6) * 0.06 : 0;

    if (busy) invalidate();
  });

  return (
    <group ref={group}>
      <mesh
        ref={body}
        geometry={pieceGeometry(token.type as PieceType)}
        material={MATERIALS[token.color]}
        castShadow
        receiveShadow
        onClick={token.square ? (e) => onPick(token.square as Square, e) : undefined}
      />
    </group>
  );
}

function fly(g: THREE.Group, body: THREE.Mesh, from: Pose, to: Pose, m: Motion, t: number, landed: number) {
  const e = m.kind === "spawn" ? t * t : ease(t);
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const dist = Math.hypot(dx, dz);
  const arc = Math.sin(Math.PI * t);

  let height = 0;
  let tilt = 0;
  let spin = 0;
  if (m.kind === "move") height = 0.14 * arc;
  if (m.kind === "hop") {
    height = (0.75 + dist * 0.08) * arc;
    tilt = 0.28 * Math.sin(Math.PI * 2 * t);
  }
  if (m.kind === "capture" || m.kind === "return") {
    const up = t < 0.22 ? ease(t / 0.22) : t > 0.78 ? ease((1 - t) / 0.22) : 1;
    height = 1.6 * up + 0.35 * arc;
    tilt = 0.45 * arc;
    spin = m.kind === "capture" ? Math.PI * 2 * ease(Math.min(1, Math.max(0, (t - 0.15) / 0.7))) : 0;
  }

  const bounceOn = m.kind !== "move";
  const bounce = bounceOn && landed > 0 ? 0.09 * Math.abs(Math.sin(landed * 15)) * Math.exp(-landed * 10) : 0;
  const squash = landed > 0 ? 1 - (bounceOn ? 0.09 : 0.04) * Math.cos(landed * 26) * Math.exp(-landed * 13) : 1;

  g.position.set(lerp(from.x, to.x, e), lerp(from.y, to.y, e) + height + bounce, lerp(from.z, to.z, e));
  const yaw = from.yaw + shortAngle(from.yaw, to.yaw) * e + spin;
  const nx = dist > 0.001 ? dx / dist : 0;
  const nz = dist > 0.001 ? dz / dist : 0;
  g.rotation.set(tilt * nz, yaw, -tilt * nx);
  body.scale.set(2 - squash, squash, 2 - squash);
}

const SPARKS = 22;

function ImpactBurst({ impact }: { impact: Impact }) {
  const ring = useRef<THREE.Mesh>(null!);
  const wave = useRef<THREE.Mesh>(null!);
  const flash = useRef<THREE.Mesh>(null!);
  const chips = useRef<THREE.InstancedMesh>(null!);
  const invalidate = useThree((s) => s.invalidate);
  const strong = impact.strong;
  const life = strong ? 0.9 : 0.7;

  const seeds = useMemo(
    () =>
      Array.from({ length: SPARKS }, (_, i) => {
        const a = (i / SPARKS) * Math.PI * 2 + Math.sin(impact.id * 13.7 + i * 4.1) * 0.4;
        const speed = (strong ? 1.6 : 0.9) * (0.6 + 0.4 * Math.abs(Math.sin(impact.id * 7.3 + i * 2.9)));
        const up = (strong ? 2.2 : 1.3) * (0.5 + 0.5 * Math.abs(Math.cos(impact.id * 3.1 + i * 5.3)));
        return { vx: Math.cos(a) * speed, vz: Math.sin(a) * speed, vy: up, size: (strong ? 0.06 : 0.045) + 0.035 * ((i * 37) % 10) / 10 };
      }),
    [impact.id, strong]
  );

  const tmp = useMemo(() => new THREE.Object3D(), []);
  const ringMat = useMemo(
    () => new THREE.MeshBasicMaterial({ color: strong ? "#ffd58a" : "#c9a27a", transparent: true, opacity: 0, depthWrite: false, toneMapped: false }),
    [strong]
  );
  const waveMat = useMemo(
    () => new THREE.MeshBasicMaterial({ color: "#fff0cf", transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }),
    []
  );
  const flashMat = useMemo(
    () => new THREE.MeshBasicMaterial({ color: "#fff1c9", transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }),
    []
  );
  const chipMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: strong ? "#ffd9a0" : "#8a6440",
        roughness: 0.6,
        emissive: strong ? "#ff9a3c" : "#2a1a0c",
        emissiveIntensity: strong ? 3 : 0.4,
      }),
    [strong]
  );

  useFrame(() => {
    const s = clock() - impact.at;
    const on = s >= 0 && s <= life;
    ring.current.visible = on;
    wave.current.visible = on && strong;
    flash.current.visible = on && strong;
    chips.current.visible = on;
    if (s < life + 0.1) invalidate();
    if (!on) return;
    const k = s / life;
    const grow = 1 - Math.pow(1 - Math.min(1, k * 1.6), 3);
    const r = (strong ? 0.45 : 0.25) + (strong ? 1.9 : 0.8) * grow;
    ring.current.scale.set(r, r, r);
    ringMat.opacity = (strong ? 1 : 0.55) * Math.pow(1 - k, 1.6);
    const k2 = Math.max(0, (s - 0.1) / (life - 0.1));
    const r2 = 0.4 + 2.8 * (1 - Math.pow(1 - k2, 2));
    wave.current.scale.set(r2, r2, r2);
    waveMat.opacity = k2 > 0 ? 0.55 * Math.pow(1 - k2, 2) : 0;
    flash.current.scale.setScalar(0.6 + k * 1.4);
    flashMat.opacity = strong ? Math.exp(-s * 7) : 0;
    for (let i = 0; i < SPARKS; i++) {
      const p = seeds[i];
      const y = Math.max(0, p.vy * s - 4.9 * s * s);
      tmp.position.set(p.vx * s, y + 0.02, p.vz * s);
      tmp.rotation.set(s * 9 + i, s * 7, 0);
      tmp.scale.setScalar(p.size * (1 - k));
      tmp.updateMatrix();
      chips.current.setMatrixAt(i, tmp.matrix);
    }
    chips.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <group position={[impact.x, impact.y + 0.012, impact.z]}>
      <mesh ref={ring} rotation-x={-Math.PI / 2} material={ringMat} visible={false} renderOrder={3}>
        <ringGeometry args={[0.66, 1, 64]} />
      </mesh>
      <mesh ref={wave} rotation-x={-Math.PI / 2} material={waveMat} visible={false} renderOrder={3}>
        <ringGeometry args={[0.9, 1, 64]} />
      </mesh>
      <mesh ref={flash} rotation-x={-Math.PI / 2} material={flashMat} visible={false} renderOrder={3}>
        <circleGeometry args={[0.85, 48]} />
      </mesh>
      <instancedMesh ref={chips} args={[undefined, undefined, SPARKS]} material={chipMat} visible={false} castShadow>
        <boxGeometry args={[1, 0.5, 0.7]} />
      </instancedMesh>
    </group>
  );
}

export function ImpactLight({ impacts }: { impacts: Impact[] }) {
  const light = useRef<THREE.PointLight>(null!);
  const invalidate = useThree((s) => s.invalidate);
  useFrame(() => {
    const now = clock();
    let best = 0;
    for (const i of impacts) {
      if (!i.strong) continue;
      const s = now - i.at;
      if (s < 0 || s > 0.6) continue;
      const v = Math.exp(-s * 7);
      if (v > best) {
        best = v;
        light.current.position.set(i.x, 0.9, i.z);
      }
    }
    light.current.intensity = 14 * best;
    if (best > 0.001) invalidate();
  });
  return <pointLight ref={light} intensity={0} distance={5} decay={2} color="#ffc27a" />;
}

export function Impacts({ impacts }: { impacts: Impact[] }) {
  return (
    <>
      {impacts.map((i) => (
        <ImpactBurst key={i.id} impact={i} />
      ))}
      <ImpactLight impacts={impacts} />
    </>
  );
}
