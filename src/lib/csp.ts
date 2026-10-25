/**
 * Content-Security-Policy (o `proxy.ts` gera o nonce e aplica). Script só
 * com nonce + `strict-dynamic` (é como Stripe.js e Analytics entram); estilo
 * com `unsafe-inline` porque há atributo `style`, que nonce não cobre.
 */
export function buildCsp(nonce: string, options: { dev?: boolean } = {}): string {
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    // Em dev o React usa eval para reconstruir stack de erro do servidor.
    "script-src": ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(options.dev ? ["'unsafe-eval'"] : [])],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:", "https://*.stripe.com"],
    "font-src": ["'self'"],
    "connect-src": ["'self'", "https://api.stripe.com", ...(options.dev ? ["ws:"] : [])],
    "frame-src": ["https://js.stripe.com", "https://hooks.stripe.com"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };
  const policy = Object.entries(directives).map(([name, values]) => `${name} ${values.join(" ")}`);
  if (!options.dev) policy.push("upgrade-insecure-requests");
  return policy.join("; ");
}
