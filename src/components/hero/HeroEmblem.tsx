"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { Emblem, EmblemSting } from "@/components/Logo";

/**
 * Emblema do hero: o portão 3D do design system, com o EmblemSting (SVG) como
 * fallback fiel. O 3D é progressivo e CONTIDO — só entra quando:
 *   - é desktop (lg+, onde o emblema aparece ao lado do texto);
 *   - o usuário não pediu menos movimento (prefers-reduced-motion);
 *   - o navegador tem WebGL.
 * Fora disso fica o SVG, que já traz a vinheta mecânica do design system.
 *
 * O three/@react-three/fiber entra por `next/dynamic` com `ssr: false`: não vai
 * no HTML inicial (não disputa o LCP) e, como a decisão de montar só acontece no
 * desktop, o bundle pesado nem é baixado no celular.
 */

const GateScene = dynamic(() => import("./GateScene"), {
  ssr: false,
  loading: () => <Emblem size={248} className="size-full text-foreground" title="Emblema DYSTOPIA" />,
});

function detectWebGL() {
  try {
    const canvas = document.createElement("canvas");
    return !!(window.WebGLRenderingContext && (canvas.getContext("webgl2") || canvas.getContext("webgl")));
  } catch {
    return false;
  }
}

export function HeroEmblem() {
  const [scene, setScene] = useState(false);
  const [active, setActive] = useState(true);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1024px)");
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const decide = () => setScene(desktop.matches && !reduce.matches && detectWebGL());
    decide();
    desktop.addEventListener("change", decide);
    reduce.addEventListener("change", decide);
    return () => {
      desktop.removeEventListener("change", decide);
      reduce.removeEventListener("change", decide);
    };
  }, []);

  // Pausa o render quando o emblema não está na tela.
  useEffect(() => {
    const el = ref.current;
    if (!el || !scene) return;
    const observer = new IntersectionObserver(([entry]) => setActive(entry.isIntersecting), { rootMargin: "120px" });
    observer.observe(el);
    return () => observer.disconnect();
  }, [scene]);

  return (
    <div ref={ref} className="size-[248px] 3xl:size-[296px]">
      {scene ? (
        <div className="size-full animate-[emblem-in_420ms_var(--ease-out)_both] motion-reduce:animate-none">
          <GateScene active={active} />
        </div>
      ) : (
        <EmblemSting size={248} className="size-full text-foreground" title="Emblema DYSTOPIA" />
      )}
    </div>
  );
}
