import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { MfaSetup } from "@/components/MfaSetup";
import { NewRecoveryCodesForm, ReplaceAuthenticatorForm, SignOutOthersForm } from "@/components/SecurityForms";
import { db } from "@/db";
import { getCurrentUser } from "@/lib/data/auth";
import { PRIVATE_PAGE } from "@/lib/seo";
import { getMfaStatus } from "@/services/mfa";
import { countActiveSessions } from "@/services/sessions";

export const metadata: Metadata = { title: "Segurança da conta", robots: PRIVATE_PAGE };

export default async function SecurityPage({ searchParams }: PageProps<"/conta/seguranca">) {
  const user = await getCurrentUser();
  if (!user) redirect("/entrar");

  const isAdminAccount = user.role === "admin";
  const [sessionCount, mfa, params] = await Promise.all([
    countActiveSessions(db, user.id),
    isAdminAccount ? getMfaStatus(db, user.id) : null,
    searchParams,
  ]);
  const usedRecoveryCode = params.recuperacao === "1";

  return (
    <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="label text-foreground-muted">Ficha / {user.email}</p>
          <h1 className="display-2 mt-3 text-[26px] leading-[34px] sm:text-[32px] sm:leading-[40px]">Segurança</h1>
        </div>
        <Link href="/conta" className="text-sm text-foreground-muted hover:text-foreground">
          ← Minha conta
        </Link>
      </div>

      {isAdminAccount && mfa ? (
        <section className="mt-8 border border-border bg-background-elevated p-5" aria-labelledby="mfa-titulo">
          <div className="flex items-center gap-2.5">
            <span className="dys-label dys-label--restricted">Comando</span>
            <h2 id="mfa-titulo" className="label text-foreground">
              Verificação em duas etapas
            </h2>
          </div>
          {mfa.enabled ? (
            <div className="mt-4 flex flex-col gap-5">
              {usedRecoveryCode ? (
                <p role="status" className="border border-foreground px-4 py-3 text-sm text-foreground">
                  Você entrou com um código de recuperação (ele não vale mais). Se o celular sumiu, troque de aparelho
                  abaixo com outro código de recuperação.
                </p>
              ) : null}
              <dl className="flex flex-col gap-3 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-foreground-muted">Autenticador</dt>
                  <dd className="font-medium">Ativo desde {mfa.confirmedAt.toLocaleDateString("pt-BR")}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-foreground-muted">Códigos de recuperação</dt>
                  <dd className="font-medium">{mfa.recoveryCodesLeft} restantes</dd>
                </div>
              </dl>
              <NewRecoveryCodesForm />
              <div className="border-t border-border-faint pt-5">
                <h3 className="label text-foreground-muted">Celular novo</h3>
                <div className="mt-3">
                  <ReplaceAuthenticatorForm />
                </div>
              </div>
              <Link href="/admin" className="label self-start text-foreground underline underline-offset-4">
                Abrir o painel →
              </Link>
            </div>
          ) : (
            <div className="mt-4 flex flex-col gap-5">
              <p className="text-sm leading-relaxed text-foreground">
                O painel de comando exige um segundo fator: além da senha, um código de 6 dígitos que muda a cada 30
                segundos no seu celular. Senha vazada sozinha não abre o painel.
              </p>
              <MfaSetup />
            </div>
          )}
        </section>
      ) : null}

      <section className="mt-8 border border-border p-5" aria-labelledby="sessoes-titulo">
        <h2 id="sessoes-titulo" className="label text-foreground-muted">
          Sessões
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-foreground">
          {sessionCount === 1
            ? "Só este aparelho está conectado."
            : `${sessionCount} sessões abertas, contando esta.`}{" "}
          Encerrar a sessão (aqui ou em outro aparelho) vale na hora: o login guardado naquele navegador para de
          funcionar.
        </p>
        <div className="mt-4">
          <SignOutOthersForm />
        </div>
      </section>
    </div>
  );
}
