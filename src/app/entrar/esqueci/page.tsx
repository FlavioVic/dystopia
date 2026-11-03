import type { Metadata } from "next";
import Link from "next/link";
import { ForgotPasswordForm } from "@/components/PasswordResetForms";
import { PRIVATE_PAGE } from "@/lib/seo";

export const metadata: Metadata = { title: "Esqueci minha senha", robots: PRIVATE_PAGE };

export default function ForgotPasswordPage() {
  return (
    <div className="mx-auto w-full max-w-sm px-4 py-16 sm:py-20">
      <p className="label text-foreground-muted">Acesso / Redefinição</p>
      <h1 className="display-2 display-2--narrow mt-4">Nova senha</h1>
      <p className="mt-3 text-sm text-foreground-muted">
        Informe o e-mail da sua conta. Enviamos um link para você escolher uma senha nova.
      </p>
      <ForgotPasswordForm />
      <p className="mt-6 text-sm text-foreground-muted">
        Lembrou?{" "}
        <Link href="/entrar" className="text-foreground underline underline-offset-4">
          Voltar para o login
        </Link>
      </p>
    </div>
  );
}
