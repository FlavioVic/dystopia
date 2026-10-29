"use client";

import Link from "next/link";
import { useActionState } from "react";
import { FormAlert, buttonPrimary, buttonSecondary, fieldLabelClass, inputClass } from "@/components/Kit";
import { RecoveryCodes } from "@/components/RecoveryCodes";
import {
  confirmMfaEnrollment,
  startMfaEnrollment,
  type MfaConfirmState,
  type MfaStartState,
} from "@/lib/actions/security";

/** Cadastro do autenticador: gerar QR → escanear → confirmar com o primeiro código. */
export function MfaSetup() {
  const [start, startAction, starting] = useActionState<MfaStartState, FormData>(startMfaEnrollment, undefined);
  const [confirm, confirmAction, confirming] = useActionState<MfaConfirmState, FormData>(confirmMfaEnrollment, undefined);

  if (confirm && "recoveryCodes" in confirm) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-foreground">Autenticador ativo. A partir de agora o login pede o código.</p>
        <RecoveryCodes codes={confirm.recoveryCodes} />
        <Link href="/admin" className={`self-start ${buttonPrimary}`}>
          Abrir o painel
        </Link>
      </div>
    );
  }

  const scan = start && "qrDataUrl" in start ? start : null;
  const startForm = (
    <form action={startAction}>
      <button type="submit" disabled={starting} className={scan ? buttonSecondary : buttonPrimary}>
        {starting ? "Gerando…" : scan ? "Gerar outro QR code" : "Configurar autenticador"}
      </button>
    </form>
  );

  if (!scan) {
    return (
      <div className="flex flex-col gap-4">
        {start && "message" in start ? <FormAlert>{start.message}</FormAlert> : null}
        {startForm}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm leading-relaxed text-foreground">
        <li>Abra o app autenticador (Google Authenticator, Authy, 1Password, Bitwarden…).</li>
        <li>Escaneie o QR code — ou digite a chave abaixo à mão.</li>
        <li>Digite o código de 6 dígitos que o app mostrar.</li>
      </ol>
      {/* Fundo claro fixo: QR invertido (claro sobre escuro) muitos leitores não leem. */}
      {/* eslint-disable-next-line @next/next/no-img-element -- data URL gerada no servidor, não passa pelo otimizador */}
      <img src={scan.qrDataUrl} alt="QR code para cadastrar a conta no app autenticador" width={200} height={200} className="bg-white" />
      <div>
        <p className={fieldLabelClass}>Chave para digitar</p>
        <p className="mt-1.5 break-all font-mono text-sm text-foreground" data-testid="mfa-manual-key">
          {scan.manualKey}
        </p>
      </div>
      <form action={confirmAction} className="flex flex-col gap-4">
        {confirm && "message" in confirm ? <FormAlert>{confirm.message}</FormAlert> : null}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="mfa-setup-code" className={fieldLabelClass}>
            Código de 6 dígitos
          </label>
          <input
            id="mfa-setup-code"
            name="code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            required
            className={`${inputClass} max-w-48 font-mono tracking-[0.2em]`}
            placeholder="000000"
          />
        </div>
        <button type="submit" disabled={confirming} className={`self-start ${buttonPrimary}`}>
          {confirming ? "Conferindo…" : "Ativar"}
        </button>
      </form>
      {startForm}
    </div>
  );
}
