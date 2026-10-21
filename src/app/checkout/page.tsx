import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CheckoutForm } from "@/components/CheckoutForm";
import { getCurrentUser } from "@/lib/data/auth";
import { getCart } from "@/lib/data/cart";

export const metadata: Metadata = { title: "Finalizar compra" };

export default async function CheckoutPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/entrar");

  const cart = await getCart();
  if (!cart || cart.lines.length === 0) redirect("/carrinho");

  return (
    <CheckoutForm
      defaultName={user.name}
      subtotalCents={cart.subtotalCents}
      lines={cart.lines.map((l) => ({
        itemId: l.itemId,
        name: l.name,
        variantName: l.variantName,
        quantity: l.quantity,
        unitPriceCents: l.unitPriceCents,
        lineTotalCents: l.lineTotalCents,
        imageUrl: l.imageUrl,
      }))}
    />
  );
}
