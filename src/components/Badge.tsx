import { type ReactNode } from "react";

const variants = {
  accent: "bg-background-elevated text-accent border border-foreground",
  secondary: "bg-background-elevated text-foreground-muted border border-foreground",
  muted: "bg-background-elevated text-foreground-muted border border-border",
  danger: "bg-signal text-on-signal border border-signal",
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
      className={`label inline-flex items-center gap-1 px-2 py-0.5 ${variants[variant]} ${className}`}
    >
      {children}
    </span>
  );
}
