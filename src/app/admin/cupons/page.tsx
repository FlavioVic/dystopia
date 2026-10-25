import type { Metadata } from "next";
import Link from "next/link";
import { CouponActions } from "@/components/admin/CouponActions";
import { requireAdmin } from "@/lib/data/auth";
import { getCouponsAdmin } from "@/lib/data/admin";
import { formatPriceCents } from "@/lib/format";

export const metadata: Metadata = { title: "Cupons · Admin" };

export default async function AdminCoupons() {
  await requireAdmin();
  const coupons = await getCouponsAdmin();

  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="label text-foreground-muted">
          Cupons ({coupons.length})
        </h2>
        <Link
          href="/admin/cupons/novo"
          className="rounded-lg bg-primary px-4 py-2 label text-primary-foreground"
        >
          + Novo cupom
        </Link>
      </div>

      {coupons.length === 0 ? (
        <p className="mt-4 text-sm text-foreground-muted">Nenhum cupom cadastrado.</p>
      ) : (
        <div tabIndex={0} role="region" aria-label="Cupons" className="mt-4 overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="border-b border-border bg-background-elevated text-left text-xs text-foreground-muted">
              <tr>
                <th className="px-4 py-2.5 font-medium">Código</th>
                <th className="px-4 py-2.5 font-medium">Desconto</th>
                <th className="px-4 py-2.5 font-medium">Pedido mínimo</th>
                <th className="px-4 py-2.5 font-medium">Usos</th>
                <th className="px-4 py-2.5 font-medium">Validade</th>
                <th className="px-4 py-2.5 font-medium">Situação</th>
                <th className="px-4 py-2.5 text-right font-medium">Ações</th>
              </tr>
            </thead>
            <tbody>
              {coupons.map((coupon) => (
                <tr key={coupon.id} className="border-b border-border last:border-0 hover:bg-background-elevated">
                  <td className="px-4 py-2.5">
                    <span className="font-mono text-xs font-bold">{coupon.code}</span>
                    {coupon.description ? (
                      <span className="block text-[11px] text-foreground-muted">{coupon.description}</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-2.5 tabular-nums">
                    {coupon.discountType === "percentage"
                      ? `${coupon.discountValue}%`
                      : formatPriceCents(coupon.discountValue)}
                  </td>
                  <td className="px-4 py-2.5 tabular-nums">
                    {coupon.minOrderCents > 0 ? formatPriceCents(coupon.minOrderCents) : "—"}
                  </td>
                  <td className="px-4 py-2.5 tabular-nums">
                    {coupon.usageCount}
                    {coupon.maxUsage == null ? " / ∞" : ` / ${coupon.maxUsage}`}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-foreground-muted">
                    {new Date(coupon.validFrom).toLocaleDateString("pt-BR")}
                    {coupon.validUntil
                      ? ` → ${new Date(coupon.validUntil).toLocaleDateString("pt-BR")}`
                      : " → sem fim"}
                  </td>
                  <td className="px-4 py-2.5">
                    <CouponActions couponId={coupon.id} isActive={coupon.isActive} />
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <Link
                      href={`/admin/cupons/${coupon.id}`}
                      className="text-sm font-medium text-accent hover:underline"
                    >
                      Editar
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
