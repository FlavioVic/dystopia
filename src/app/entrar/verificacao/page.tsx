import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { MfaLoginForm } from "@/components/MfaLoginForm";
import { getCurrentUser, getPendingMfaUser } from "@/lib/data/auth";
import { PRIVATE_PAGE } from "@/lib/seo";

export const metadata: Metadata = { title: "Verificação em duas etapas", robots: PRIVATE_PAGE };

export default async function MfaVerificationPage() {
  const pending = await getPendingMfaUser();
  if (!pending) redirect((await getCurrentUser()) ? "/conta" : "/entrar");

  return (
    <div className="mx-auto w-full max-w-sm px-4 py-16 sm:py-20">
      <p className="label text-foreground-muted">Acesso / Verificação</p>
      <h1 className="display-2 display-2--narrow mt-4">Segunda etapa</h1>
      <p className="mt-3 text-sm text-foreground-muted">
        Senha conferida para {pending.email}. Abra o app autenticador e digite o código de 6 dígitos.
      </p>
      <MfaLoginForm />
      <p className="mt-6 text-sm text-foreground-muted">
        Não é você?{" "}
        <Link href="/entrar" className="text-foreground underline underline-offset-4">
          Voltar para o login
        </Link>
      </p>
    </div>
  );
}
