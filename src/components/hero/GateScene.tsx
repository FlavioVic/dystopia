"use client";

import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

/**
 * Emblema "The Gate" em relevo — a versão 3D do EmblemSting do design system.
 *
 * Monocromático (folhas em bone, aro em steel) sobre obsidian. Sem glow, sem
 * cor de luz, sem reflexo de ambiente: só luz branca e matéria fosca, para não
 * virar enfeite neon. A geometria é a mesma do emblema 2D (aro r9–r12, duas
 * folhas dentro de r7 separadas por um vão central) — o portão nasce fechado e
 * NUNCA abre: o único movimento é o parallax mecânico que acompanha o ponteiro,
 * amortecido ("entra, para"). Carregado só no desktop e fora do caminho de LCP
 * (ver HeroEmblem): este módulo nem chega ao bundle do celular.
 */

const BONE = "#e7e3da";
const STEEL = "#6e7176";

// Unidades do emblema (viewBox 24): raio do círculo das folhas e meia-fenda.
const LEAF_R = 7;
const SEAM = 1.5;
const EXTRUDE = { depth: 1.0, bevelEnabled: true, bevelThickness: 0.16, bevelSize: 0.16, bevelSegments: 2, curveSegments: 72 } as const;

function ringGeometry() {
  const shape = new THREE.Shape();
  shape.absarc(0, 0, 12, 0, Math.PI * 2, false);
  const hole = new THREE.Path();
  hole.absarc(0, 0, 9, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  const geo = new THREE.ExtrudeGeometry(shape, EXTRUDE);
  geo.center();
  return geo;
}

function leafGeometry(side: "left" | "right") {
  const shape = new THREE.Shape();
  const ay = Math.sqrt(LEAF_R * LEAF_R - SEAM * SEAM);
  if (side === "left") {
    shape.moveTo(-SEAM, ay);
    shape.absarc(0, 0, LEAF_R, Math.atan2(ay, -SEAM), Math.atan2(-ay, -SEAM), false);
  } else {
    shape.moveTo(SEAM, ay);
    shape.absarc(0, 0, LEAF_R, Math.atan2(ay, SEAM), Math.atan2(-ay, SEAM), true);
  }
  const geo = new THREE.ExtrudeGeometry(shape, EXTRUDE);
  geo.translate(0, 0, -EXTRUDE.depth / 2);
  return geo;
}

function Gate() {
  const rig = useRef<THREE.Group>(null);
  const { invalidate, pointer, gl } = useThree();
  const intro = useRef<number | null>(null);

  // frameloop "demand": o ponteiro sobre o emblema religa o loop; parado, não
  // renderiza. A entrada se auto-dirige pelo invalidate() do useFrame.
  useEffect(() => {
    const el = gl.domElement;
    const wake = () => invalidate();
    el.addEventListener("pointermove", wake);
    return () => el.removeEventListener("pointermove", wake);
  }, [gl, invalidate]);

  const ring = useMemo(() => ringGeometry(), []);
  const left = useMemo(() => leafGeometry("left"), []);
  const right = useMemo(() => leafGeometry("right"), []);
  const boneMat = useMemo(() => new THREE.MeshStandardMaterial({ color: BONE, roughness: 0.52, metalness: 0.0 }), []);
  const steelMat = useMemo(() => new THREE.MeshStandardMaterial({ color: STEEL, roughness: 0.42, metalness: 0.08 }), []);

  useFrame((state) => {
    const g = rig.current;
    if (!g) return;
    if (intro.current === null) intro.current = state.clock.elapsedTime;
    // Entrada mecânica: assenta no lugar em 0,5 s e para. Não abre.
    const t = Math.min((state.clock.elapsedTime - intro.current) / 0.5, 1);
    const introRot = (1 - t) * -0.32;

    // Parallax contido: o ponteiro inclina o portão alguns graus, amortecido.
    const desiredY = pointer.x * 0.17 + introRot;
    const desiredX = -pointer.y * 0.12;
    g.rotation.y += (desiredY - g.rotation.y) * 0.1;
    g.rotation.x += (desiredX - g.rotation.x) * 0.1;
    g.scale.setScalar(0.9 + 0.1 * t);

    const settled = t >= 1 && Math.abs(desiredY - g.rotation.y) < 1e-4 && Math.abs(desiredX - g.rotation.x) < 1e-4;
    if (!settled) invalidate();
  });

  // Escala 1/12: raio 12 do emblema vira 1 unidade de mundo.
  return (
    <group ref={rig} scale={0.9}>
      <group scale={1 / 12}>
        <mesh geometry={ring} material={steelMat} />
        {/* Folhas recuadas: ficam atrás da face do aro, como portas num batente. */}
        <group position={[0, 0, -0.55]}>
          <mesh geometry={left} material={boneMat} />
          <mesh geometry={right} material={boneMat} />
        </group>
      </group>
    </group>
  );
}

/**
 * `active` desliga o loop de render quando o emblema sai da tela (controlado
 * pelo HeroEmblem via IntersectionObserver): parado, não consome GPU.
 */
export default function GateScene({ active = true }: { active?: boolean }) {
  return (
    <Canvas
      // flat: sem tone mapping filmico (nada de glow). dpr limitado por custo.
      flat
      dpr={[1, 1.75]}
      frameloop={active ? "demand" : "never"}
      gl={{ alpha: true, antialias: true, powerPreference: "low-power" }}
      camera={{ position: [0, 0, 4.8], fov: 30 }}
      style={{ width: "100%", height: "100%" }}
      aria-hidden="true"
    >
      <ambientLight intensity={0.42} />
      <directionalLight position={[-3, 4, 5]} intensity={2.1} />
      <directionalLight position={[4, -2, 2]} intensity={0.45} />
      <Gate />
    </Canvas>
  );
}
