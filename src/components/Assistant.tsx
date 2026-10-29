"use client";

import Link from "next/link";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { buttonCompact, buttonPrimary, inputClass } from "@/components/Kit";
import { parseRichText } from "@/lib/assistant/rich-text";

type Turn = { role: "user" | "assistant"; content: string };

const STORAGE_KEY = "dystopia.assistente";
const MAX_INPUT = 1_000;
const SUGGESTIONS = ["Placa de vídeo até R$ 3.000", "Onde está meu pedido?", "Quero orçar uma montagem"];

/** Conversa da aba: sobrevive à navegação e ao recarregar, some ao fechar a aba. */
function loadTurns(): Turn[] {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

function saveTurns(turns: Turn[]) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(turns.slice(-40)));
  } catch {
    // Aba privada ou armazenamento bloqueado: a conversa só não sobrevive ao recarregar.
  }
}

function RichText({ text }: { text: string }) {
  return parseRichText(text).map((segment, index) =>
    segment.type === "link" ? (
      <Link key={index} href={segment.href} className="underline underline-offset-2 hover:text-foreground-muted">
        {segment.text}
      </Link>
    ) : (
      <span key={index}>{segment.text}</span>
    ),
  );
}

/**
 * Assistente da loja: botão fixo no canto e painel de conversa. Mora no
 * layout, então a conversa continua quando a pessoa segue um link da resposta.
 */
export function Assistant() {
  const [open, setOpen] = useState(false);
  // No servidor não há sessionStorage (loadTurns cai no catch e devolve []).
  // Não dá diferença de hidratação: o painel começa fechado e o botão não
  // depende da conversa.
  const [turns, setTurns] = useState<Turn[]>(loadTurns);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // Abriu: foco no campo. Fechou: foco de volta no botão — que só existe de
  // novo depois desta renderização, por isso é efeito e não parte do `close`.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open) inputRef.current?.focus();
    else if (wasOpen.current) toggleRef.current?.focus();
    wasOpen.current = open;
  }, [open]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [turns, pending, open]);

  function close() {
    setOpen(false);
  }

  async function send(text: string) {
    const content = text.trim().slice(0, MAX_INPUT);
    if (!content || pending) return;
    const next: Turn[] = [...turns, { role: "user", content }];
    setTurns(next);
    saveTurns(next);
    setDraft("");
    setError(null);
    setPending(true);
    try {
      const response = await fetch("/api/assistente", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: next }),
      });
      const data = (await response.json().catch(() => ({}))) as { reply?: string; error?: string };
      if (!response.ok || !data.reply) {
        setError(data.error ?? "Assistente indisponível no momento.");
        return;
      }
      const answered: Turn[] = [...next, { role: "assistant", content: data.reply }];
      setTurns(answered);
      saveTurns(answered);
    } catch {
      setError("Sem conexão. Tente de novo.");
    } finally {
      setPending(false);
      inputRef.current?.focus();
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void send(draft);
  }

  function clear() {
    setTurns([]);
    saveTurns([]);
    setError(null);
    inputRef.current?.focus();
  }

  return (
    <>
      {!open && (
        <button
          ref={toggleRef}
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded={false}
          aria-controls="assistente"
          className="label fixed bottom-4 right-4 z-40 flex items-center gap-2 border border-foreground bg-background px-4 py-3 text-foreground transition-colors duration-150 hover:bg-foreground hover:text-background"
        >
          <span aria-hidden="true" className="h-2 w-2 bg-signal" />
          Assistente
        </button>
      )}

      {open && (
        <section
          id="assistente"
          role="dialog"
          aria-label="Assistente da loja"
          onKeyDown={(event) => event.key === "Escape" && close()}
          className="fixed bottom-4 right-4 z-40 flex h-[min(36rem,calc(100dvh-2rem))] w-[calc(100vw-2rem)] max-w-sm flex-col border border-border bg-background-elevated"
        >
          <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
            <p className="label text-foreground">
              Assistente <span className="text-foreground-muted">/ DYS-A01</span>
            </p>
            <div className="flex items-center gap-1">
              {turns.length > 0 && (
                <button type="button" onClick={clear} className={buttonCompact}>
                  Limpar
                </button>
              )}
              <button type="button" onClick={close} className={buttonCompact}>
                Fechar
              </button>
            </div>
          </header>

          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4 text-sm" aria-live="polite">
            <p className="text-foreground-muted">
              Peças, pedidos e serviços. As respostas são geradas por IA e consultam o catálogo da loja. A conversa
              é enviada ao provedor do modelo e não fica gravada no site: evite dados pessoais. Veja a{" "}
              <Link href="/privacidade" className="text-foreground underline underline-offset-4">
                privacidade
              </Link>
              .
            </p>
            {turns.length === 0 && (
              <ul className="flex flex-wrap gap-2" aria-label="Sugestões">
                {SUGGESTIONS.map((suggestion) => (
                  <li key={suggestion}>
                    <button
                      type="button"
                      onClick={() => void send(suggestion)}
                      className="border border-border-faint px-3 py-1.5 text-left text-xs text-foreground hover:border-foreground"
                    >
                      {suggestion}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {turns.map((turn, index) => (
              <div
                key={index}
                className={
                  turn.role === "user"
                    ? "ml-8 whitespace-pre-wrap bg-foreground px-3 py-2 text-background"
                    : "mr-8 whitespace-pre-wrap border border-border-faint bg-background px-3 py-2 text-foreground"
                }
              >
                <span className="sr-only">{turn.role === "user" ? "Você: " : "Assistente: "}</span>
                {turn.role === "assistant" ? <RichText text={turn.content} /> : turn.content}
              </div>
            ))}
            {pending && <p className="label text-foreground-muted">Consultando…</p>}
            {error && (
              <p role="alert" className="flex items-center gap-2 text-xs text-foreground">
                <span aria-hidden="true" className="h-2 w-2 shrink-0 bg-signal" />
                {error}
              </p>
            )}
            <div ref={endRef} />
          </div>

          <form onSubmit={onSubmit} className="flex gap-2 border-t border-border p-3">
            <label htmlFor="assistente-mensagem" className="sr-only">
              Mensagem
            </label>
            <input
              ref={inputRef}
              id="assistente-mensagem"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              maxLength={MAX_INPUT}
              placeholder="Escreva sua pergunta"
              autoComplete="off"
              className={`${inputClass} min-w-0 flex-1`}
            />
            <button type="submit" disabled={pending || !draft.trim()} className={`${buttonPrimary} px-4`}>
              Enviar
            </button>
          </form>
        </section>
      )}
    </>
  );
}
