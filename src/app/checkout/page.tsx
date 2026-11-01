import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CheckoutForm } from "@/components/CheckoutForm";
import { getAddresses } from "@/lib/data/account";
import { getCurrentUser } from "@/lib/data/auth";
import { getCart } from "@/lib/data/cart";
import { isCheckoutSimulationEnabled } from "@/lib/checkout-simulation";
import { getStripePublishableKey } from "@/lib/stripe-public";
import { formatAddress } from "@/lib/validation/address";
import { PRIVATE_PAGE } from "@/lib/seo";

export const metadata: Metadata = { title: "Finalizar compra", robots: PRIVATE_PAGE };
// Vale para Server Action do formulário também: com o worker embutido, o
// `after` do placeOrder drena a fila (até 45 s) dentro desta função.
export const maxDuration = 60;

export default async function CheckoutPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/entrar");

  const cart = await getCart();
  // Item que saiu de venda: o carrinho mostra qual é e pede para tirar.
  if (!cart || cart.lines.length === 0 || cart.hasUnavailable) redirect("/carrinho");

  const addresses = await getAddresses(user.id);

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
