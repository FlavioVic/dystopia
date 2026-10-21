import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CouponForm } from "@/components/admin/CouponForm";
import { updateCoupon } from "@/lib/actions/admin";
import { getCouponForEdit } from "@/lib/data/admin";
import { requireAdmin } from "@/lib/data/auth";
import { formatDateInput } from "@/lib/validation/coupon";

export const metadata: Metadata = { title: "Editar cupom · Admin" };

export default async function EditCouponPage(props: PageProps<"/admin/cupons/[id]">) {
  await requireAdmin();
  const { id } = await props.params;
  const coupon = await getCouponForEdit(id);
  if (!coupon) notFound();

  const action = updateCoupon.bind(null, id);

  return (
    <div className="max-w-3xl">
      <h2 className="font-brand text-xl font-bold uppercase tracking-tight">Editar cupom</h2>
      <p className="mt-1 font-mono text-sm text-foreground-muted">{coupon.code}</p>
      <div className="mt-6">
        <CouponForm
          mode="edit"
          action={action}
          defaults={{
            code: coupon.code,
            description: coupon.description,
            discountType: coupon.discountType,
            discountValue:
              coupon.discountType === "percentage"
                ? String(coupon.discountValue)
                : (coupon.discountValue / 100).toFixed(2),
            minOrder: coupon.minOrderCents > 0 ? (coupon.minOrderCents / 100).toFixed(2) : "",
            maxUsage: coupon.maxUsage == null ? "" : String(coupon.maxUsage),
            validFrom: formatDateInput(new Date(coupon.validFrom)),
            validUntil: coupon.validUntil ? formatDateInput(new Date(coupon.validUntil)) : "",
            isActive: coupon.isActive,
            usageCount: coupon.usageCount,
          }}
        />
      </div>
    </div>
  );
}
