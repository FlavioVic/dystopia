import type { Metadata } from "next";
import { CouponForm } from "@/components/admin/CouponForm";
import { createCoupon } from "@/lib/actions/admin";
import { requireAdmin } from "@/lib/data/auth";
import { formatDateInput } from "@/lib/validation/coupon";

export const metadata: Metadata = { title: "Novo cupom · Admin" };

export default async function NewCouponPage() {
  await requireAdmin();

  return (
    <div className="max-w-3xl">
      <h2 className="display-3 text-[20px] leading-[28px]">Novo cupom</h2>
      <div className="mt-6">
        <CouponForm
          mode="create"
          action={createCoupon}
          defaults={{ validFrom: formatDateInput(new Date()), isActive: true }}
        />
      </div>
    </div>
  );
}
