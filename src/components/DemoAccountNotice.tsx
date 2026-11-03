/**
 * Aviso de quem está na conta demo (senha pública em /sobre): tudo que ela
 * guarda — endereço, pedido — qualquer outro visitante vê ao entrar.
 */
export function DemoAccountNotice({ className = "" }: { className?: string }) {
  return (
    <p role="note" className={`border border-foreground px-4 py-3 text-sm text-foreground ${className}`}>
      Você está na conta pública de demonstração: qualquer visitante entra nela e vê o que ficar salvo aqui. Não use
      nome, endereço nem telefone reais.
    </p>
  );
}
