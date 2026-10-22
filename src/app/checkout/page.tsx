import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CheckoutForm } from "@/components/CheckoutForm";
import { db } from "@/db";
import { getCurrentUser } from "@/lib/data/auth";
import { getCart } from "@/lib/data/cart";
import { isCheckoutSimulationEnabled } from "@/lib/checkout-simulation";
import { getStripePublishableKey } from "@/lib/stripe-public";
import { formatAddress } from "@/lib/validation/address";
import { listAddresses } from "@/services/addresses";

export const metadata: Metadata = { title: "Finalizar compra" };

export default async function CheckoutPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/entrar");

  const cart = await getCart();
  if (!cart || cart.lines.length === 0) redirect("/carrinho");

  const addresses = await listAddresses(db, user.id);

  return (
    <CheckoutForm
      defaultName={user.name}
      savedAddresses={addresses.map((address) => ({
        id: address.id,
        label: address.label,
        recipientName: address.recipientName,
        line: formatAddress(address),
        isDefault: address.isDefault,
      }))}
      subtotalCents={cart.subtotalCents}
      simulationEnabled={isCheckoutSimulationEnabled()}
      stripePublishableKey={getStripePublishableKey()}
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
