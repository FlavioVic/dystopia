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
  const dim = size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4";

  return (
    <div className="flex items-center gap-1.5">
      <div className="flex" aria-label={`${rating.toFixed(1)} de 5 estrelas`}>
        {Array.from({ length: 5 }).map((_, i) => (
          <svg
            key={i}
            viewBox="0 0 20 20"
            className={`${dim} ${i < full ? "fill-accent-secondary" : "fill-border"}`}
          >
            <path d="M10 1.5l2.6 5.6 6.1.6-4.6 4.1 1.3 6-5.4-3.1-5.4 3.1 1.3-6L1.3 7.7l6.1-.6z" />
          </svg>
        ))}
      </div>
      {typeof count === "number" && (
        <span className="text-xs text-foreground-muted">({count})</span>
      )}
    </div>
  );
}
