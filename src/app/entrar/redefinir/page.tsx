import type { Metadata } from "next";
import Link from "next/link";
import { ResetPasswordForm } from "@/components/PasswordResetForms";
import { buttonPrimary } from "@/components/Kit";
import { getPasswordResetLinkValidity } from "@/lib/data/auth";
import { PRIVATE_PAGE } from "@/lib/seo";

// O token está na URL: nenhum link desta página manda o endereço adiante.
export const metadata: Metadata = { title: "Redefinir senha", robots: PRIVATE_PAGE, referrer: "no-referrer" };

export default async function ResetPasswordPage({ searchParams }: PageProps<"/entrar/redefinir">) {
  const { token } = await searchParams;
  const value = typeof token === "string" ? token : undefined;
  const valid = await getPasswordResetLinkValidity(value);

  return (
    <div className="mx-auto w-full max-w-sm px-4 py-16 sm:py-20">
      <p className="label text-foreground-muted">Acesso / Redefinição</p>
      <h1 className="display-2 display-2--narrow mt-4">Nova senha</h1>
      {valid && value ? (
        <>
          <p className="mt-3 text-sm text-foreground-muted">
            Escolha a senha nova. Ao salvar, todos os logins abertos da conta são encerrados.
          </p>
          <ResetPasswordForm token={value} />
        </>
      ) : (
        <>
          <p className="mt-3 text-sm text-foreground">
            Este link não vale mais: já foi usado, venceu (ele dura 30 minutos) ou foi trocado por um mais novo.
          </p>
          <Link href="/entrar/esqueci" className={`mt-7 w-full ${buttonPrimary}`}>
            Pedir outro link
          </Link>
        </>
      )}
    </div>
  );
}
