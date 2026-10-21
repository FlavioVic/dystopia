"use client";

import Link from "next/link";
import { useActionState } from "react";
import { login, signup, type AuthState } from "@/lib/actions/auth";

const inputClass =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-foreground-muted focus:border-accent focus:ring-2 focus:ring-accent/30";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const action = mode === "signup" ? signup : login;
  const [state, formAction, pending] = useActionState<AuthState, FormData>(action, undefined);

  const isSignup = mode === "signup";

  return (
    <div className="mx-auto w-full max-w-sm px-4 py-16 sm:py-20">
      <h1 className="text-2xl font-bold tracking-tight">
        {isSignup ? "Criar conta" : "Entrar"}
      </h1>
      <p className="mt-1.5 text-sm text-foreground-muted">
        {isSignup
          ? "Crie sua conta pra acompanhar pedidos e finalizar compras."
          : "Bem-vindo de volta à megacidade."}
      </p>

      <form action={formAction} className="mt-7 flex flex-col gap-4" noValidate>
        {state?.message ? (
          <p className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
            {state.message}
          </p>
        ) : null}

        {isSignup ? (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="name" className="text-sm font-medium">
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
            {state?.errors?.name ? (
              <p className="text-xs text-danger">{state.errors.name}</p>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-col gap-1.5">
          <label htmlFor="email" className="text-sm font-medium">
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
          {state?.errors?.email ? (
            <p className="text-xs text-danger">{state.errors.email}</p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="password" className="text-sm font-medium">
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
          {state?.errors?.password ? (
            <p className="text-xs text-danger">{state.errors.password}</p>
          ) : null}
        </div>

        <button
          type="submit"
          disabled={pending}
          className="mt-1 w-full rounded-md bg-accent px-5 py-2.5 text-sm font-semibold text-accent-foreground transition-transform enabled:hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? (isSignup ? "Criando…" : "Entrando…") : isSignup ? "Criar conta" : "Entrar"}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-foreground-muted">
        {isSignup ? (
          <>
            Já tem conta?{" "}
            <Link href="/entrar" className="text-accent hover:underline">
              Entrar
            </Link>
          </>
        ) : (
          <>
            Não tem conta?{" "}
            <Link href="/cadastro" className="text-accent hover:underline">
              Criar conta
            </Link>
          </>
        )}
      </p>
    </div>
  );
}
