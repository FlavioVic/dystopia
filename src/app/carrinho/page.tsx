import type { Metadata } from "next";
import Link from "next/link";
import { CartItemRow } from "@/components/CartItemRow";
import { buttonPrimary } from "@/components/Kit";
import { getCart } from "@/lib/data/cart";
import { formatPriceCents } from "@/lib/format";
import { FREE_SHIPPING_MIN_CENTS } from "@/lib/shipping";
import { PRIVATE_PAGE } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Carrinho",
  robots: PRIVATE_PAGE,
};

export default async function CartPage() {
  const cart = await getCart();

  if (!cart || cart.lines.length === 0) {
    return (
      <div className="mx-auto flex max-w-7xl flex-col items-start gap-6 px-4 py-24 sm:px-6 lg:px-8">
        <p className="label text-foreground-muted">Carrinho / 00 itens</p>
        <h1 className="display-2 text-[26px] leading-[34px] sm:text-[40px] sm:leading-[48px]">Nenhum item registrado.</h1>
        <p className="max-w-md text-base text-foreground-muted">
          O carrinho permanece salvo na sua ficha até a aquisição ser concluída.
        </p>
        <Link href="/produtos" className={buttonPrimary}>
          Consultar inventário
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      <p className="label text-foreground-muted">
        Carrinho / {String(cart.count).padStart(2, "0")} {cart.count === 1 ? "item" : "itens"}
      </p>
      <h1 className="display-2 mt-4 text-[26px] leading-[34px] sm:text-[40px] sm:leading-[48px]">Carrinho</h1>

      <div className="mt-10 grid gap-10 lg:grid-cols-[1fr_22rem]">
        <section aria-label="Itens do carrinho">
          <ul className="divide-y divide-border-faint border-y border-border-faint">
            {cart.lines.map((line) => (
              <CartItemRow key={line.itemId} line={line} />
            ))}
          </ul>
          <Link href="/produtos" className="label mt-6 inline-flex text-foreground-muted hover:text-foreground">
            Voltar ao inventário
          </Link>
        </section>

        <aside className="lg:sticky lg:top-40 lg:self-start">
          <div className="border border-border-faint bg-background-elevated p-6">
            <h2 className="label text-foreground-muted">Resumo</h2>
            <dl className="mt-5 flex flex-col gap-3 text-sm">
              <div className="flex justify-between">
                <dt className="text-foreground-muted">Subtotal</dt>
                <dd className="font-mono">{formatPriceCents(cart.subtotalCents)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-foreground-muted">Frete</dt>
                <dd className="text-foreground-muted">calculado na aquisição</dd>
              </div>
              <div className="mt-2 flex justify-between border-t border-border pt-4 text-base font-semibold">
                <dt>Total</dt>
                <dd className="font-mono">{formatPriceCents(cart.subtotalCents)}</dd>
              </div>
            </dl>

            <Link href="/checkout" className={`mt-6 w-full ${buttonPrimary}`}>
              Prosseguir para aquisição
            </Link>
            <p className="mt-3 text-xs text-foreground-muted">
              Frete sem custo acima de {formatPriceCents(FREE_SHIPPING_MIN_CENTS)}. Pagamento simulado.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
