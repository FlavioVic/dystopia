"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Revela o bloco quando entra na tela (uma vez). O CSS em globals.css só
 * esconde quando o <head> marcou `.js-reveal`, então sem JS nada some.
 *
 * `immediate`: para o que já aparece na primeira tela. A animação é só CSS e
 * começa no primeiro paint — esperar a hidratação deixava o título da home
 * invisível por ~2 s num celular lento (LCP).
 */
export function Reveal({
  children,
  delay = 0,
  className = "",
  as: Tag = "div",
  immediate = false,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
  as?: "div" | "section" | "li" | "article";
  immediate?: boolean;
}) {
  if (immediate) {
    return (
      <Tag className={`reveal-now ${className}`} style={{ "--delay": `${delay}ms` } as React.CSSProperties}>
        {children}
      </Tag>
    );
  }
  return <ObservedReveal delay={delay} className={className} as={Tag}>{children}</ObservedReveal>;
}

function ObservedReveal({
  children,
  delay,
  className,
  as: Tag,
}: {
  children: ReactNode;
  delay: number;
  className: string;
  as: "div" | "section" | "li" | "article";
}) {
  const ref = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "0px 0px -8% 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <Tag
      ref={ref as never}
      data-visible={visible}
      className={`reveal ${className}`}
      style={{ "--delay": `${delay}ms` } as React.CSSProperties}
    >
      {children}
    </Tag>
  );
}
