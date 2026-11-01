import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AddressForm } from "@/components/AddressForm";
import { AddressRowActions } from "@/components/AddressRowActions";
import { getAddresses } from "@/lib/data/account";
import { getCurrentUser } from "@/lib/data/auth";
import { formatAddress } from "@/lib/validation/address";
import { PRIVATE_PAGE } from "@/lib/seo";

export const metadata: Metadata = { title: "Endereços", robots: PRIVATE_PAGE };

export default async function AddressesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/entrar");

  const addresses = await getAddresses(user.id);

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="display-2 text-[26px] leading-[34px] sm:text-[32px] sm:leading-[40px]">Endereços</h1>
          <p className="mt-1 text-sm text-foreground-muted">
            Os endereços salvos aparecem como opção no checkout.
          </p>
        </div>
        <Link href="/conta" className="text-sm text-foreground-muted hover:text-foreground">
          ← Minha conta
        </Link>
      </div>

      {addresses.length > 0 ? (
        <ul className="mt-6 flex flex-col gap-3">
          {addresses.map((address) => (
            <li
              key={address.id}
              className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-border bg-background-elevated p-4"
            >
              <div className="min-w-0 text-sm">
                <p className="flex flex-wrap items-center gap-2 font-medium">
                  {address.label}
                  {address.isDefault ? (
                    <span className="dys-label dys-label--notice">
                      padrão
                    </span>
                  ) : null}
                </p>
                <p className="text-foreground-muted">{address.recipientName}</p>
                <p className="text-xs text-foreground-muted">{formatAddress(address)}</p>
              </div>
              <AddressRowActions addressId={address.id} isDefault={address.isDefault} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-6 rounded-xl border border-border p-5 text-sm text-foreground-muted">
          Nenhum endereço salvo ainda. O endereço do seu próximo pedido entra aqui automaticamente.
        </p>
      )}

      <div className="mt-6">
        <AddressForm hasAddresses={addresses.length > 0} />
      </div>
    </div>
  );
}
