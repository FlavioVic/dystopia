import { ViewTransition, type ReactNode } from "react";

/**
 * Transição entre páginas do storefront. Usa o `<ViewTransition>` nativo do
 * React 19.3 (sem biblioteca, sem violar a CSP): na navegação, o conteúdo antigo
 * sai com um corte seco e o novo entra assentando no lugar — "entra, para". O
 * cabeçalho e o rodapé ficam fixos (a CSS zera a animação do `root`), e o
 * movimento some inteiro em `prefers-reduced-motion` (ver globals.css).
 *
 * Envolve UM nó DOM só (a API do view transition precisa de um elemento com
 * caixa), então o conteúdo da página mora neste `div`.
 */
export function PageTransition({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <ViewTransition enter="page-enter" exit="page-exit" default="none">
      <div className={className}>{children}</div>
    </ViewTransition>
  );
}
