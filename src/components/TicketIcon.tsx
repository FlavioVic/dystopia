/**
 * Ícone de cupom (ingresso picotado), no mesmo traço dos ícones do Header.
 * Substitui o emoji 🎟️: emoji muda de desenho em cada sistema e não herda a
 * cor do texto; o SVG fica igual em todo lugar e segue `currentColor`.
 */
export function TicketIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 8.5V7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v1.5a3.5 3.5 0 0 0 0 7V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1.5a3.5 3.5 0 0 0 0-7Z" />
      <path d="M14 5.5v2M14 11v2M14 16.5v2" strokeLinecap="round" />
    </svg>
  );
}
