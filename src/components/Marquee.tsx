/**
 * Faixa contínua. O conteúdo vai duas vezes para a animação fechar o laço em
 * -50%; a segunda cópia é escondida de leitor de tela.
 */
export function Marquee({ items }: { items: string[] }) {
  const row = (hidden: boolean) => (
    <ul aria-hidden={hidden || undefined} className="flex shrink-0 items-center">
      {items.map((item) => (
        <li key={item} className="display-4 flex items-center gap-8 whitespace-nowrap pr-8 text-[13px] text-foreground">
          {item}
          <span aria-hidden="true" className="h-2 w-2 bg-primary" />
        </li>
      ))}
    </ul>
  );
  return (
    <div className="marquee overflow-hidden border-y border-border bg-background-elevated py-5">
      <div className="marquee-track">
        {row(false)}
        {row(true)}
      </div>
    </div>
  );
}
