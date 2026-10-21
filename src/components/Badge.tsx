import { type ReactNode } from "react";

const variants = {
  accent: "bg-accent/10 text-accent border border-accent/30",
  secondary: "bg-accent-secondary/10 text-accent-secondary border border-accent-secondary/30",
  muted: "bg-background-elevated text-foreground-muted border border-border",
  danger: "bg-danger/10 text-danger border border-danger/30",
} as const;

export function Badge({
  children,
  variant = "muted",
  className = "",
}: {
  children: ReactNode;
  variant?: keyof typeof variants;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium tracking-wide ${variants[variant]} ${className}`}
    >
      {children}
    </span>
  );
}
