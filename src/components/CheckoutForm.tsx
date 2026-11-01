"use client";

import Image from "next/image";
import { buttonPrimary } from "@/components/Kit";
import { useActionState, useRef, useState, useTransition, type FormEvent } from "react";
import { StripeCardField, type StripeCardHandle } from "@/components/StripeCardField";
import { placeOrder, validateCoupon } from "@/lib/actions/checkout";
import { FLAT_SHIPPING_CENTS, FREE_SHIPPING_MIN_CENTS, type CouponResult } from "@/lib/shipping";
import { formatPriceCents } from "@/lib/format";

export type SavedAddress = {
  id: string;
  label: string;
  recipientName: string;
  line: string;
  isDefault: boolean;
};

type Line = {
  itemId: string;
  name: string;
  variantName: string | null;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
  imageUrl: string | null;
};

const input =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-foreground-muted focus:border-foreground";

const methods = [
  { id: "pix", label: "Pix", hint: "aprovação na hora" },
  { id: "credit_card", label: "Cartão", hint: "até 4x sem juros" },
  { id: "boleto", label: "Boleto", hint: "vence em 3 dias" },
];

// Cenários de TEST_PAYMENT_TOKENS (services/payments/contract); o texto diz o que a
// saga vai fazer, que é o ponto da demonstração.
const simulations = [
  { id: "approve", label: "Aprovar", hint: "caminho feliz: os 6 passos concluem" },
  { id: "decline", label: "Recusar pagamento", hint: "falha permanente: a reserva de estoque é desfeita" },
  { id: "flaky_once", label: "Gateway instável", hint: "falha uma vez, a fila tenta de novo e aprova" },
  { id: "unavailable", label: "Gateway fora do ar", hint: "esgota as tentativas com backoff e desfaz tudo" },
];

export function CheckoutForm({
  defaultName,
  lines,
  subtotalCents,
  savedAddresses = [],
  simulationEnabled = false,
  stripePublishableKey = null,
}: {
  defaultName: string;
  lines: Line[];
  subtotalCents: number;
  savedAddresses?: SavedAddress[];
  simulationEnabled?: boolean;
  /** Com chave, cartão vai pelo Stripe Elements; sem, segue no simulado. */
  stripePublishableKey?: string | null;
}) {
  const [state, formAction, pending] = useActionState(placeOrder, undefined);
  const [method, setMethod] = useState(methods[0].id);
  const cardRef = useRef<StripeCardHandle>(null);
  const [cardError, setCardError] = useState<string | null>(null);
  const [tokenizing, startTokenizing] = useTransition();
  const stripeCard = method === "credit_card" && stripePublishableKey != null;

  // Cartão no Stripe: antes da Server Action, troca o cartão por um token
  // (`pm_…`) no navegador. O resto dos métodos segue o `action` normal.
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    if (!stripeCard) return;
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setCardError(null);
    startTokenizing(async () => {
      const result = await cardRef.current?.createPaymentMethod();
      if (!result || "error" in result) {
        setCardError(result?.error ?? "Não foi possível validar o cartão.");
        return;
      }
      data.set("cardPaymentMethodId", result.id);
      startTokenizing(() => formAction(data));
    });
  }
  // Começa no endereço padrão (ou no primeiro salvo); sem nada salvo, no formulário.
  const [addressChoice, setAddressChoice] = useState<string>(
    savedAddresses.find((address) => address.isDefault)?.id ?? savedAddresses[0]?.id ?? "new",
  );
  const [couponCode, setCouponCode] = useState("");
  const [coupon, setCoupon] = useState<CouponResult | null>(null);
  const [couponPending, startCoupon] = useTransition();

  const discount = coupon?.ok ? (coupon.discountCents ?? 0) : 0;
  const shipping = subtotalCents >= FREE_SHIPPING_MIN_CENTS ? 0 : FLAT_SHIPPING_CENTS;
  const total = Math.max(0, subtotalCents - discount) + shipping;

  function applyCoupon() {
    if (!couponCode.trim()) return;
    startCoupon(async () => setCoupon(await validateCoupon(couponCode, subtotalCents)));
  }

  const err = state?.errors ?? {};

  return (
    <form action={formAction} onSubmit={handleSubmit} className="mx-auto max-w-site px-4 py-12 sm:px-6 lg:px-8">
      <p className="label text-foreground-muted">Aquisição / Protocolo de compra</p>
      <h1 className="display-2 mt-4 text-[26px] leading-[34px] sm:text-[40px] sm:leading-[48px]">Aquisição</h1>

      {state?.message ? (
        <p role="alert" className="mt-4 bg-signal px-4 py-3 text-sm text-on-signal">
          {state.message}
        </p>
      ) : null}

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_22rem]">
        <div className="flex flex-col gap-8">
          {/* Endereço */}
          <section className="border border-border-faint bg-background-elevated p-6">
            <h2 className="label text-foreground-muted">01 / Destino da entrega</h2>

            {savedAddresses.length > 0 ? (
              <div className="mt-4 flex flex-col gap-2">
                {savedAddresses.map((address) => (
                  <label
                    key={address.id}
                    className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-border p-3 transition-colors has-[:checked]:border-foreground"
                  >
                    <input
                      type="radio"
                      name="addressChoice"
                      value={address.id}
                      checked={addressChoice === address.id}
                      onChange={() => setAddressChoice(address.id)}
                      className="mt-0.5 accent-[var(--foreground)]"
                    />
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                        {address.label}
                        {address.isDefault ? (
                          <span className="dys-label dys-label--notice">Padrão</span>
                        ) : null}
                      </span>
                      <span className="block text-[11px] text-foreground-muted">{address.recipientName}</span>
                      <span className="block text-[11px] text-foreground-muted">{address.line}</span>
                    </span>
                  </label>
                ))}

                <label className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-border p-3 transition-colors has-[:checked]:border-foreground">
                  <input
                    type="radio"
                    name="addressChoice"
                    value="new"
                    checked={addressChoice === "new"}
                    onChange={() => setAddressChoice("new")}
                    className="accent-[var(--foreground)]"
                  />
                  <span className="text-sm font-medium">Registrar outro endereço</span>
                </label>
              </div>
            ) : null}

            {/* O servidor recebe só o id; endereço novo vai nos campos abaixo. */}
            {addressChoice !== "new" ? (
              <input type="hidden" name="addressId" value={addressChoice} />
            ) : null}

            <div
              className={`mt-4 grid grid-cols-2 gap-3 sm:grid-cols-6 ${addressChoice === "new" ? "" : "hidden"}`}
            >
              <Field className="sm:col-span-6" label="Destinatário" name="recipientName" defaultValue={defaultName} error={err.recipientName} />
              <Field className="sm:col-span-2" label="CEP" name="zipCode" placeholder="00000-000" error={err.zipCode} />
              <Field className="sm:col-span-4" label="Rua" name="street" error={err.street} />
              <Field className="sm:col-span-2" label="Número" name="number" error={err.number} />
              <Field className="sm:col-span-4" label="Complemento (opcional)" name="complement" />
              <Field className="sm:col-span-3" label="Bairro" name="neighborhood" error={err.neighborhood} />
              <Field className="sm:col-span-2" label="Cidade" name="city" error={err.city} />
              <Field className="sm:col-span-1" label="UF" name="state" placeholder="SP" maxLength={2} error={err.state} />
            </div>
          </section>

          {/* Pagamento */}
          <section className="border border-border-faint bg-background-elevated p-6">
            <h2 className="label text-foreground-muted">02 / Pagamento</h2>
            <p className="mt-1 text-xs text-foreground-muted">
              {stripePublishableKey
                ? "Cartão pelo Stripe em modo de teste; Pix e boleto simulados. Nenhum valor real é cobrado."
                : "Simulado. Nenhum pagamento real é processado."}
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              {methods.map((m) => (
                <label
                  key={m.id}
                  className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-border p-3 transition-colors has-[:checked]:border-foreground"
                >
                  <input
                    type="radio"
                    name="paymentMethod"
                    value={m.id}
                    checked={method === m.id}
                    onChange={() => setMethod(m.id)}
                    className="mt-0.5 accent-[var(--foreground)]"
                  />
                  <span>
                    <span className="block text-sm font-medium">{m.label}</span>
                    <span className="block text-[11px] text-foreground-muted">
                      {m.id === "credit_card" && stripePublishableKey ? "via Stripe · modo de teste" : m.hint}
                    </span>
                  </span>
                </label>
              ))}
            </div>
            {stripeCard ? <StripeCardField ref={cardRef} publishableKey={stripePublishableKey} /> : null}
            {cardError ? (
              <p role="alert" className="mt-2 text-xs text-foreground">
                {cardError}
              </p>
            ) : null}
          </section>

          {simulationEnabled ? (
            <section className="rounded-2xl border border-dashed border-foreground bg-background-elevated p-5">
              <h2 className="label text-foreground-muted">
                Modo demonstração
              </h2>
              <p className="mt-1 text-xs text-foreground-muted">
                Escolha o que o gateway simulado responde e veja, na página do pedido, a saga reagir.
              </p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {simulations.map((s, i) => (
                  <label
                    key={s.id}
                    className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-border p-3 transition-colors has-[:checked]:border-foreground"
                  >
                    <input
                      type="radio"
                      name="simulate"
                      value={s.id}
                      defaultChecked={i === 0}
                      className="mt-0.5 accent-[var(--foreground)]"
                    />
                    <span>
                      <span className="block text-sm font-medium">{s.label}</span>
                      <span className="block text-[11px] text-foreground-muted">{s.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </section>
          ) : null}
        </div>

        {/* Resumo */}
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="border border-border-faint bg-background-elevated p-6">
            <h2 className="label text-foreground-muted">
              Resumo ({lines.reduce((n, l) => n + l.quantity, 0)})
            </h2>

            <ul className="mt-4 flex flex-col gap-3">
              {lines.map((l) => (
                <li key={l.itemId} className="flex items-center gap-3">
                  <span className="relative h-12 w-12 shrink-0 overflow-hidden rounded-md border border-border bg-background">
                    {l.imageUrl ? (
                      <Image src={l.imageUrl} alt={l.name} fill sizes="48px" className="object-cover" />
                    ) : null}
                    <span className="absolute -right-1.5 -top-1.5 flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-foreground px-1 font-mono text-[10px] font-bold text-background">
                      {l.quantity}
                    </span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-1 text-xs font-medium">{l.name}</span>
                    {l.variantName ? (
                      <span className="block text-[11px] text-foreground-muted">{l.variantName}</span>
                    ) : null}
                  </span>
                  <span className="font-mono text-xs tabular-nums">{formatPriceCents(l.lineTotalCents)}</span>
                </li>
              ))}
            </ul>

            {/* Cupom */}
            <div className="mt-5 border-t border-border pt-4">
              <div className="flex gap-2">
                <input
                  type="text"
                  name="couponCode"
                  value={couponCode}
                  onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                  placeholder="Código de diretiva (ex.: BEMVINDO10)"
                  className={`${input} font-mono uppercase`}
                />
                <button
                  type="button"
                  onClick={applyCoupon}
                  disabled={couponPending}
                  className="shrink-0 rounded-lg border border-foreground px-3 text-sm font-semibold text-foreground-muted transition-colors hover:bg-background-elevated disabled:opacity-50"
                >
                  {couponPending ? "…" : "Aplicar"}
                </button>
              </div>
              {coupon ? (
                <p className={`mt-1.5 text-xs ${coupon.ok ? "text-foreground" : "text-foreground"}`}>{coupon.message}</p>
              ) : null}
            </div>

            {/* Totais */}
            <dl className="mt-4 flex flex-col gap-2 border-t border-border pt-4 text-sm">
              <Row label="Subtotal" value={formatPriceCents(subtotalCents)} />
              {discount > 0 ? <Row label="Desconto" value={`- ${formatPriceCents(discount)}`} accent="deal" /> : null}
              <Row label="Frete" value={shipping === 0 ? "Sem custo" : formatPriceCents(shipping)} accent={shipping === 0 ? "deal" : undefined} />
              <div className="mt-1 flex items-baseline justify-between border-t border-border pt-3">
                <dt className="text-base font-semibold">Total</dt>
                <dd className="font-mono text-xl font-bold text-accent tabular-nums">{formatPriceCents(total)}</dd>
              </div>
            </dl>

            <button
              type="submit"
              disabled={pending || tokenizing}
              className={`mt-5 w-full ${buttonPrimary}`}
            >
              {pending || tokenizing ? "Processando…" : "Confirmar aquisição"}
            </button>
            <p className="mt-2 text-center text-[11px] text-foreground-muted">
              Ao confirmar, a aquisição é registrada. Os termos são fictícios.
            </p>
          </div>
        </aside>
      </div>
    </form>
  );
}

function Field({
  label,
  name,
  className = "",
  error,
  ...rest
}: {
  label: string;
  name: string;
  className?: string;
  error?: string;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <label htmlFor={name} className="text-[11px] font-medium uppercase tracking-wide text-foreground-muted">
        {label}
      </label>
      <input id={name} name={name} className={input} {...rest} />
      {error ? <span className="text-[11px] text-foreground">{error}</span> : null}
    </div>
  );
}

function Row({ label, value, accent }: { label: string; value: string; accent?: "deal" }) {
  return (
    <div className="flex justify-between">
      <dt className="text-foreground-muted">{label}</dt>
      <dd className={`font-mono tabular-nums ${accent === "deal" ? "font-semibold text-foreground" : ""}`}>{value}</dd>
    </div>
  );
}
