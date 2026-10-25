"use client";

import Link from "next/link";
import { useActionState } from "react";
import { FieldError, FormAlert, buttonPrimary, fieldLabelClass, inputClass } from "@/components/Kit";
import { login, signup, type AuthState } from "@/lib/actions/auth";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const action = mode === "signup" ? signup : login;
  const [state, formAction, pending] = useActionState<AuthState, FormData>(action, undefined);

  const isSignup = mode === "signup";

  return (
    <div className="mx-auto w-full max-w-sm px-4 py-16 sm:py-20">
      <p className="label text-foreground-muted">{isSignup ? "Registro / Nova ficha" : "Acesso / Identificação"}</p>
      <h1 className="display-2 mt-4 text-[26px] leading-[34px] sm:text-[32px] sm:leading-[40px]">
        {isSignup ? "Registro" : "Identificação"}
      </h1>
      <p className="mt-3 text-sm text-foreground-muted">
        {isSignup
          ? "Abra sua ficha para registrar aquisições e acompanhar pedidos."
          : "Apresente suas credenciais. Tentativas são registradas."}
      </p>

      <form action={formAction} className="mt-7 flex flex-col gap-4" noValidate>
        {state?.message ? (
          <FormAlert>{state.message}</FormAlert>
        ) : null}

        {isSignup ? (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="name" className={fieldLabelClass}>
              Nome
            </label>
            <input
              id="name"
              name="name"
              type="text"
              autoComplete="name"
              defaultValue={state?.values?.name ?? ""}
              className={inputClass}
              placeholder="Seu nome"
            />
            <FieldError message={state?.errors?.name} />
          </div>
        ) : null}

        <div className="flex flex-col gap-1.5">
          <label htmlFor="email" className={fieldLabelClass}>
            E-mail
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            defaultValue={state?.values?.email ?? ""}
            className={inputClass}
            placeholder="voce@exemplo.com"
          />
          <FieldError message={state?.errors?.email} />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="password" className={fieldLabelClass}>
            Senha
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete={isSignup ? "new-password" : "current-password"}
            className={inputClass}
            placeholder={isSignup ? "Mín. 8 caracteres" : "Sua senha"}
          />
          <FieldError message={state?.errors?.password} />
        </div>

        <button
          type="submit"
          disabled={pending}
          className={`mt-2 w-full ${buttonPrimary}`}
        >
          {pending ? "Verificando…" : isSignup ? "Abrir ficha" : "Identificar-se"}
        </button>
        {isSignup ? (
          <p className="text-xs leading-relaxed text-foreground-muted">
            Ao criar a conta, seus dados são tratados como descrito na{" "}
            <Link href="/privacidade" className="text-foreground underline underline-offset-4">
              política de privacidade
            </Link>
            .
          </p>
        ) : null}
      </form>

      <p className="mt-6 text-sm text-foreground-muted">
        {isSignup ? (
          <>
            Já possui ficha?{" "}
            <Link href="/entrar" className="text-foreground underline underline-offset-4">
              Identificar-se
            </Link>
          </>
        ) : (
          <>
            Sem ficha?{" "}
            <Link href="/cadastro" className="text-foreground underline underline-offset-4">
              Abrir registro
            </Link>
          </>
        )}
      </p>
    </div>
  );
}
