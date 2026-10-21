export function PromoBar() {
  return (
    <div className="gradient-brand text-white">
      <div className="mx-auto flex max-w-7xl items-center justify-center gap-x-2 gap-y-0.5 px-4 py-2 text-center text-[12px] font-medium leading-tight sm:text-sm">
        <span className="hidden sm:inline" aria-hidden>
          🎟️
        </span>
        <span>
          Cupom{" "}
          <strong className="rounded bg-white/20 px-1.5 py-0.5 font-mono font-bold tracking-wide">
            BEMVINDO10
          </strong>{" "}
          — 10% OFF na primeira compra
        </span>
        <span className="hidden text-white/60 md:inline">·</span>
        <span className="hidden md:inline">Frete grátis a partir de R$ 149,90</span>
      </div>
    </div>
  );
}
