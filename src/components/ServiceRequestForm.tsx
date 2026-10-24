"use client";

import { useActionState } from "react";
import { FieldError, FormAlert, buttonPrimary, fieldLabelClass, inputClass } from "@/components/Kit";
import { requestService, type ServiceRequestState } from "@/lib/actions/services";
import { SERVICES, type ServiceKind } from "@/lib/services-catalog";
import { MAX_DETAILS_LENGTH } from "@/lib/validation/service-request";

export function ServiceRequestForm({ defaultKind }: { defaultKind?: ServiceKind }) {
  const [state, formAction, pending] = useActionState<ServiceRequestState, FormData>(requestService, undefined);

  if (state?.protocol) {
    return (
      <div className="dys-frame flex flex-col gap-4 p-8" role="status">
        <p className="label text-foreground-muted">Solicitação registrada</p>
        <p className="font-mono text-3xl font-semibold">{state.protocol}</p>
        <p className="text-base leading-relaxed text-foreground-muted">
          Guarde o protocolo. O retorno é feito pelo e-mail informado. Nenhuma intervenção começa sem orçamento
          aprovado.
        </p>
      </div>
    );
  }

  const err = state?.errors ?? {};
  const values = state?.values ?? {};

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      {state?.message ? <FormAlert>{state.message}</FormAlert> : null}

      <fieldset>
        <legend className={fieldLabelClass}>Serviço</legend>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {SERVICES.map((s) => (
            <label
              key={s.kind}
              className="flex cursor-pointer items-center gap-3 border border-border px-4 py-3 text-sm has-[:checked]:border-foreground has-[:checked]:bg-foreground has-[:checked]:text-background"
            >
              <input
                type="radio"
                name="kind"
                value={s.kind}
                defaultChecked={(values.kind || defaultKind) === s.kind}
                className="sr-only"
              />
              <span className="serial opacity-70">{s.serial.slice(-2)}</span>
              {s.name}
            </label>
          ))}
        </div>
        <FieldError message={err.kind} />
      </fieldset>

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="sr-name" className={fieldLabelClass}>
            Nome
          </label>
          <input
            id="sr-name"
            name="name"
            autoComplete="name"
            defaultValue={values.name ?? ""}
            aria-invalid={err.name ? true : undefined}
            className={`mt-2 ${inputClass}`}
          />
          <FieldError message={err.name} />
        </div>
        <div>
          <label htmlFor="sr-email" className={fieldLabelClass}>
            E-mail
          </label>
          <input
            id="sr-email"
            name="email"
            type="email"
            autoComplete="email"
            defaultValue={values.email ?? ""}
            aria-invalid={err.email ? true : undefined}
            className={`mt-2 ${inputClass}`}
          />
          <FieldError message={err.email} />
        </div>
      </div>

      <div>
        <label htmlFor="sr-phone" className={fieldLabelClass}>
          Telefone / WhatsApp (opcional)
        </label>
        <input
          id="sr-phone"
          name="phone"
          type="tel"
          autoComplete="tel"
          placeholder="(11) 91234-5678"
          defaultValue={values.phone ?? ""}
          aria-invalid={err.phone ? true : undefined}
          className={`mt-2 ${inputClass}`}
        />
        <FieldError message={err.phone} />
      </div>

      <div>
        <label htmlFor="sr-details" className={fieldLabelClass}>
          Descrição da necessidade
        </label>
        <textarea
          id="sr-details"
          name="details"
          rows={6}
          maxLength={MAX_DETAILS_LENGTH}
          defaultValue={values.details ?? ""}
          placeholder="Equipamento, sintomas, prazo, orçamento disponível. Seja preciso."
          aria-invalid={err.details ? true : undefined}
          className={`mt-2 ${inputClass}`}
        />
        <FieldError message={err.details} />
      </div>

      <button type="submit" disabled={pending} className={`${buttonPrimary} self-start`}>
        {pending ? "Registrando…" : "Registrar solicitação"}
      </button>
    </form>
  );
}
