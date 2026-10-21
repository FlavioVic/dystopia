import type { Metadata } from "next";
import Link from "next/link";
import { CartItemRow } from "@/components/CartItemRow";
import { getCart } from "@/lib/data/cart";
import { formatPriceCents } from "@/lib/format";

export const metadata: Metadata = {
  title: "Carrinho",
};

export default async function CartPage() {
  const cart = await getCart();

  if (!cart || cart.lines.length === 0) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col items-center px-4 py-24 text-center sm:px-6">
        <div className="flex h-14 w-14 items-center justify-center rounded-full border border-border text-foreground-muted">
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.75">
            <path
              d="M3 3h1.5l1.3 12.2a2 2 0 0 0 2 1.8h8.9a2 2 0 0 0 2-1.7L20 8H6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle cx="9.5" cy="20" r="1.3" fill="currentColor" stroke="none" />
            <circle cx="17" cy="20" r="1.3" fill="currentColor" stroke="none" />
          </svg>
        </div>
        <h1 className="mt-5 text-xl font-bold tracking-tight">Seu carrinho está vazio</h1>
        <p className="mt-2 max-w-sm text-sm text-foreground-muted">
          Explore o catálogo e adicione itens — eles ficam salvos aqui até você fechar o pedido.
        </p>
        <Link
          href="/produtos"
          className="mt-6 rounded-md bg-accent px-5 py-2.5 text-sm font-semibold text-accent-foreground"
        >
          Ver produtos
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-bold tracking-tight">
        Carrinho{" "}
        <span className="font-mono text-base font-normal text-foreground-muted">
          ({cart.count} {cart.count === 1 ? "item" : "itens"})
        </span>
      </h1>

      <div className="mt-8 grid gap-10 lg:grid-cols-[1fr_20rem]">
        <section aria-label="Itens do carrinho">
          <ul className="divide-y divide-border border-y border-border">
            {cart.lines.map((line) => (
              <CartItemRow key={line.itemId} line={line} />
            ))}
          </ul>
          <Link
            href="/produtos"
            className="mt-6 inline-flex items-center gap-1.5 text-sm text-accent hover:underline"
          >
            <span aria-hidden>←</span> Continuar comprando
          </Link>
        </section>

        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-lg border border-border bg-background-elevated p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-foreground-muted">
              Resumo
            </h2>
            <dl className="mt-4 flex flex-col gap-2.5 text-sm">
              <div className="flex justify-between">
                <dt className="text-foreground-muted">Subtotal</dt>
                <dd className="font-mono tabular-nums">{formatPriceCents(cart.subtotalCents)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-foreground-muted">Frete</dt>
                <dd className="text-foreground-muted">calculado no checkout</dd>
              </div>
              <div className="mt-2 flex justify-between border-t border-border pt-3 text-base font-semibold">
                <dt>Total</dt>
                <dd className="font-mono tabular-nums">{formatPriceCents(cart.subtotalCents)}</dd>
              </div>
            </dl>

            <Link
              href="/checkout"
              className="mt-5 flex w-full items-center justify-center rounded-xl bg-accent px-5 py-3.5 text-sm font-bold text-accent-foreground transition-transform hover:scale-[1.01]"
            >
              Finalizar compra
            </Link>
            <p className="mt-2 text-center text-[11px] text-foreground-muted">
              Frete grátis acima de R$ 149,90 · pagamento simulado.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
