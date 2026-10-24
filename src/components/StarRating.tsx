/**
 * Nota de avaliação. A marca não usa ícone decorativo: cinco quadrados (cheio =
 * ponto atingido) e o número em mono.
 */
export function StarRating({
  rating,
  count,
  size = "sm",
}: {
  rating: number;
  count?: number;
  size?: "sm" | "md";
}) {
  const full = Math.round(rating);
  const dim = size === "sm" ? "h-2 w-2" : "h-2.5 w-2.5";

  return (
    <div className="flex items-center gap-2" aria-label={`${rating.toFixed(1)} de 5`}>
      <div className="flex gap-1" aria-hidden="true">
        {Array.from({ length: 5 }).map((_, i) => (
          <span key={i} className={`${dim} border border-foreground ${i < full ? "bg-foreground" : ""}`} />
        ))}
      </div>
      <span className="font-mono text-xs text-foreground-muted">
        {rating.toFixed(1)}
        {typeof count === "number" ? ` / ${String(count).padStart(2, "0")}` : ""}
      </span>
    </div>
  );
}
