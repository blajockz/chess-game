import "./Board3D.css";
import { useEffect, useMemo, useRef, useState, type ElementRef } from "react";
import { Canvas, useThree, type ThreeEvent } from "@react-three/fiber";
import { Environment, Lightformer, OrbitControls, PerformanceMonitor, SoftShadows } from "@react-three/drei";
import { Bloom, DepthOfField, EffectComposer, N8AO, ToneMapping, Vignette } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import * as THREE from "three";
import type { Square } from "chess.js";
import type { BoardProps } from "../components/Board";
import { pieceGeometry, type PieceType } from "./pieces.ts";
import { BOARD_SIZE, SPECIES, boardMaps, pieceMaterial, plankMaps } from "./materials.ts";

type Quality = "high" | "low";

const FILES = "abcdefgh";

function at(square: string): [number, number] {
  const f = FILES.indexOf(square[0]);
  const r = Number(square[1]);
  return [f - 3.5, 4.5 - r];
}

const ALL_SQUARES: Square[] = [];
for (let r = 8; r >= 1; r--) for (const f of FILES) ALL_SQUARES.push((f + r) as Square);

function homeView(flipped: boolean) {
  const z = flipped ? -12.6 : 12.6;
  return { position: new THREE.Vector3(0, 10.6, z), target: new THREE.Vector3(0, -0.2, flipped ? -0.5 : 0.5) };
}

function CameraRig({ flipped, resetKey }: { flipped: boolean; resetKey: number }) {
  const controls = useRef<ElementRef<typeof OrbitControls>>(null);
  const { camera, invalidate } = useThree();
  useEffect(() => {
    const v = homeView(flipped);
    const c = controls.current;
    camera.position.copy(v.position);
    if (c) {
      c.target.copy(v.target);
      c.enableDamping = false;
      c.update();
      c.enableDamping = true;
    }
    invalidate();
  }, [flipped, resetKey, camera, invalidate]);
  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enablePan={false}
      enableDamping
      dampingFactor={0.12}
      minDistance={7}
      maxDistance={20}
      minPolarAngle={0.12}
      maxPolarAngle={1.32}
      rotateSpeed={0.6}
    />
  );
}

function DevProbe() {
  const { camera, size, gl, controls, invalidate } = useThree();
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as { __board3d?: (sq: string, h?: number) => { x: number; y: number } };
    w.__board3d = (sq: string, h = 0.05) => {
      const [x, z] = at(sq);
      camera.updateMatrixWorld();
      const v = new THREE.Vector3(x, h, z).project(camera);
      const r = gl.domElement.getBoundingClientRect();
      return { x: r.left + ((v.x + 1) / 2) * size.width, y: r.top + ((1 - v.y) / 2) * size.height };
    };
    (w as unknown as { __camera3d?: (p: number[], t: number[]) => void }).__camera3d = (p, t) => {
      camera.position.set(p[0], p[1], p[2]);
      const c = controls as unknown as { target: THREE.Vector3; update: () => void } | null;
      c?.target.set(t[0], t[1], t[2]);
      c?.update();
      invalidate();
    };
    return () => {
      delete w.__board3d;
    };
  }, [camera, size, gl, controls, invalidate]);
  return null;
}

function Table() {
  const mat = useMemo(() => {
    const m = plankMaps(SPECIES.walnut, 21, 1024);
    for (const t of [m.map, m.roughnessMap, m.normalMap]) t.repeat.set(7, 7);
    return new THREE.MeshPhysicalMaterial({
      ...m,
      color: "#6f5f54",
      roughness: 0.7,
      clearcoat: 0.35,
      clearcoatRoughness: 0.45,
      normalScale: new THREE.Vector2(0.6, 0.6),
    });
  }, []);
  return (
    <mesh rotation-x={-Math.PI / 2} position-y={-0.36} receiveShadow material={mat}>
      <planeGeometry args={[40, 40]} />
    </mesh>
  );
}

function ChessBoard() {
  const { geometry, materials } = useMemo(() => {
    const half = BOARD_SIZE / 2;
    const r = 0.12;
    const shape = new THREE.Shape();
    shape.moveTo(-half + r, -half);
    shape.lineTo(half - r, -half);
    shape.quadraticCurveTo(half, -half, half, -half + r);
    shape.lineTo(half, half - r);
    shape.quadraticCurveTo(half, half, half - r, half);
    shape.lineTo(-half + r, half);
    shape.quadraticCurveTo(-half, half, -half, half - r);
    shape.lineTo(-half, -half + r);
    shape.quadraticCurveTo(-half, -half, -half + r, -half);
    const g = new THREE.ExtrudeGeometry(shape, {
      depth: 0.3,
      bevelEnabled: true,
      bevelThickness: 0.035,
      bevelSize: 0.035,
      bevelSegments: 5,
      curveSegments: 8,
    });
    const pos = g.getAttribute("position");
    const uv = g.getAttribute("uv");
    for (let i = 0; i < pos.count; i++) {
      uv.setXY(i, (pos.getX(i) + half) / BOARD_SIZE, (pos.getY(i) + half) / BOARD_SIZE);
    }
    g.rotateX(-Math.PI / 2);
    g.translate(0, -0.035 - 0.3, 0);
    const top = boardMaps();
    const side = plankMaps(SPECIES.rosewood, 9, 512);
    return {
      geometry: g,
      materials: [
        new THREE.MeshPhysicalMaterial({
          ...top,
          roughness: 0.55,
          normalScale: new THREE.Vector2(0.35, 0.35),
          clearcoat: 1,
          clearcoatRoughness: 0.14,
        }),
        new THREE.MeshPhysicalMaterial({ ...side, roughness: 0.5, clearcoat: 0.8, clearcoatRoughness: 0.2 }),
      ],
    };
  }, []);
  return <mesh geometry={geometry} material={materials} receiveShadow castShadow />;
}

type Cell = BoardProps["board"][number][number];

const MATERIALS = { w: pieceMaterial("w"), b: pieceMaterial("b") };

function Piece({ cell, onPick }: { cell: NonNullable<Cell>; onPick: (sq: Square, e: ThreeEvent<MouseEvent>) => void }) {
  const [x, z] = at(cell.square);
  const turn = cell.type === "n" ? (cell.color === "w" ? Math.PI / 2 : -Math.PI / 2) + 0.95 : 0;
  return (
    <mesh
      geometry={pieceGeometry(cell.type as PieceType)}
      material={MATERIALS[cell.color]}
      position={[x, 0, z]}
      rotation-y={turn}
      castShadow
      receiveShadow
      onClick={(e) => onPick(cell.square, e)}
    />
  );
}

function Tint({ square, color, opacity, inset = 0 }: { square: string; color: string; opacity: number; inset?: number }) {
  const [x, z] = at(square);
  return (
    <mesh position={[x, 0.004, z]} rotation-x={-Math.PI / 2} renderOrder={1}>
      <planeGeometry args={[1 - inset, 1 - inset]} />
      <meshBasicMaterial color={color} transparent opacity={opacity} depthWrite={false} />
    </mesh>
  );
}

function Marker({ square, ring, color, opacity }: { square: string; ring: boolean; color: string; opacity: number }) {
  const [x, z] = at(square);
  return (
    <mesh position={[x, 0.008, z]} rotation-x={-Math.PI / 2} renderOrder={2}>
      {ring ? <ringGeometry args={[0.36, 0.46, 40]} /> : <circleGeometry args={[0.13, 32]} />}
      <meshBasicMaterial color={color} transparent opacity={opacity} depthWrite={false} />
    </mesh>
  );
}

function HitAreas({ onPick }: { onPick: (sq: Square, e: ThreeEvent<MouseEvent>) => void }) {
  return (
    <group>
      {ALL_SQUARES.map((sq) => {
        const [x, z] = at(sq);
        return (
          <mesh key={sq} position={[x, 0.01, z]} rotation-x={-Math.PI / 2} onClick={(e) => onPick(sq, e)}>
            <planeGeometry args={[1, 1]} />
            <meshBasicMaterial visible={false} />
          </mesh>
        );
      })}
    </group>
  );
}

function Scene(props: BoardProps & { resetKey: number; quality: Quality }) {
  const {
    board,
    selected,
    legalTargets,
    lastMove,
    checkSquare,
    matedSquare = null,
    premove = null,
    premoveFrom = null,
    flipped = false,
    onSquareClick,
    cardTargets = [],
    cardPicked = [],
    shielded = null,
    resetKey,
    quality,
  } = props;

  const occupied = new Set<string>();
  for (const row of board) for (const c of row) if (c) occupied.add(c.square);

  const pick = (sq: Square, e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (e.delta > 6) return;
    onSquareClick(sq);
  };

  return (
    <>
      <color attach="background" args={["#0f0b08"]} />
      <fog attach="fog" args={["#0f0b08", 16, 34]} />
      <CameraRig flipped={flipped} resetKey={resetKey} />
      {import.meta.env.DEV && <DevProbe />}

      {}
      <hemisphereLight args={["#ffe9cf", "#1a0f08", 0.08]} />
      <directionalLight
        position={[-6.5, 8, 5]}
        intensity={2.8}
        color="#fff4e6"
        castShadow
        shadow-mapSize={quality === "high" ? [2048, 2048] : [1024, 1024]}
        shadow-bias={-0.0003}
        shadow-normalBias={0.025}
        shadow-camera-left={-7}
        shadow-camera-right={7}
        shadow-camera-top={7}
        shadow-camera-bottom={-7}
        shadow-camera-near={2}
        shadow-camera-far={30}
      />
      <pointLight position={[7, 5.5, -3]} intensity={18} distance={22} decay={2} color="#ffb070" />

      {}
      <Environment resolution={256} frames={1}>
        <color attach="background" args={["#0b0806"]} />
        {[-1.2, 1.2].map((x) =>
          [-1.6, 1.6].map((y) => (
            <Lightformer
              key={`${x}:${y}`}
              form="rect"
              intensity={2.4}
              color="#eef3ff"
              position={[-9, 4 + y, 2 + x]}
              rotation-y={Math.PI / 2}
              scale={[2.1, 2.9, 1]}
            />
          ))
        )}
        <Lightformer form="circle" intensity={4} color="#ffb169" position={[8, 4, -4]} scale={2.2} />
        <Lightformer form="rect" intensity={0.45} color="#fff1dd" position={[0, 9, 0]} rotation-x={Math.PI / 2} scale={[14, 14, 1]} />
        <Lightformer form="rect" intensity={0.25} color="#5a3a24" position={[0, -2, 0]} rotation-x={-Math.PI / 2} scale={[30, 30, 1]} />
      </Environment>

      <Table />
      <ChessBoard />

      {lastMove && (
        <>
          <Tint square={lastMove.from} color="#e8c46a" opacity={0.22} />
          <Tint square={lastMove.to} color="#e8c46a" opacity={0.32} />
        </>
      )}
      {premoveFrom && <Tint square={premoveFrom} color="#6c9be0" opacity={0.4} />}
      {premove && (
        <>
          <Tint square={premove.from} color="#6c9be0" opacity={0.35} />
          <Tint square={premove.to} color="#6c9be0" opacity={0.45} />
        </>
      )}
      {selected && <Tint square={selected} color="#f2cf6a" opacity={0.5} />}
      {checkSquare && <Tint square={checkSquare} color="#e0442c" opacity={0.55} inset={0.04} />}
      {matedSquare && <Tint square={matedSquare} color="#b0200f" opacity={0.7} inset={0.04} />}
      {shielded && <Marker square={shielded} ring color="#7fb8ff" opacity={0.85} />}
      {legalTargets.map((sq) => (
        <Marker key={"t" + sq} square={sq} ring={occupied.has(sq)} color="#1a120b" opacity={occupied.has(sq) ? 0.55 : 0.4} />
      ))}
      {cardTargets.map((sq) => (
        <Marker key={"c" + sq} square={sq} ring color="#ff9a3c" opacity={0.8} />
      ))}
      {cardPicked.map((sq) => (
        <Tint key={"p" + sq} square={sq} color="#ff9a3c" opacity={0.5} />
      ))}

      <HitAreas onPick={pick} />
      {board.flat().map((cell) => cell && <Piece key={cell.square} cell={cell} onPick={pick} />)}
    </>
  );
}

const PROMOTIONS: { piece: "q" | "r" | "b" | "n"; label: string; glyph: string }[] = [
  { piece: "q", label: "Queen", glyph: "♛" },
  { piece: "r", label: "Rook", glyph: "♜" },
  { piece: "b", label: "Bishop", glyph: "♝" },
  { piece: "n", label: "Knight", glyph: "♞" },
];

function PhotoLook({ quality }: { quality: Quality }) {
  if (quality === "low") {
    return (
      <EffectComposer multisampling={0}>
        <ToneMapping mode={ToneMappingMode.AGX} />
      </EffectComposer>
    );
  }
  return (
    <EffectComposer multisampling={4}>
      <N8AO aoRadius={0.5} distanceFalloff={0.5} intensity={3.2} color="#000000" quality="medium" />
      <DepthOfField target={[0, 0, 0]} focalLength={0.12} bokehScale={0.9} height={540} />
      <Bloom intensity={0.22} luminanceThreshold={0.82} luminanceSmoothing={0.2} mipmapBlur />
      <ToneMapping mode={ToneMappingMode.AGX} />
      <Vignette offset={0.32} darkness={0.55} />
    </EffectComposer>
  );
}

export default function Board3D(props: BoardProps) {
  const [resetKey, setResetKey] = useState(0);
  const [quality, setQuality] = useState<Quality>("high");
  const { pending = null, onPromote, onCancelPromotion } = props;
  return (
    <div className="board3d" onDoubleClick={() => setResetKey((k) => k + 1)} title="Drag to turn around the board, scroll to zoom, double-click to reset">
      <Canvas
        shadows
        dpr={quality === "high" ? [1, 2] : 1}
        frameloop="demand"
        camera={{ fov: 32, near: 0.1, far: 80, position: homeView(!!props.flipped).position.toArray() }}
        gl={{ antialias: false, toneMapping: THREE.NoToneMapping, powerPreference: "high-performance" }}
      >
        <PerformanceMonitor onDecline={() => setQuality("low")} flipflops={2} />
        {quality === "high" && <SoftShadows size={22} samples={12} focus={0.6} />}
        <Scene {...props} resetKey={resetKey} quality={quality} />
        <PhotoLook quality={quality} />
      </Canvas>

      {pending && (
        <div className="board3d-promo" role="dialog" aria-label="Choose a piece">
          <span>Promote to</span>
          <div className="board3d-promo-row">
            {PROMOTIONS.map((p) => (
              <button
                key={p.piece}
                className={"board3d-promo-btn is-" + pending.color}
                onClick={() => onPromote?.(p.piece)}
                aria-label={p.label}
                title={p.label}
              >
                {p.glyph}
              </button>
            ))}
          </div>
          <button className="board3d-promo-cancel" onClick={() => onCancelPromotion?.()}>
            Cancel
          </button>
        </div>
      )}
      <span className="board3d-hint" aria-hidden="true">
        Drag to turn · scroll to zoom · double-click to reset
      </span>
    </div>
  );
}
