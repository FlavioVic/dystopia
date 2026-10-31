## Contexto

<!-- Por que este PR existe: o problema, o feedback ou o pedido que ele resolve. -->

## O que muda

<!-- As mudanças que importam para quem revisa, em tópicos. Decisão de
arquitetura? Diga a alternativa que ficou de fora e por quê. -->

## Como foi verificado

- [ ] `npx tsc --noEmit` e `npm run lint`
- [ ] `npm test` (Postgres e RabbitMQ reais)
- [ ] `npm run build`
- [ ] e2e (`npm run test:e2e`) contra a stack do compose, quando muda tela ou fluxo

<!-- Casos novos que valem citar e o que foi conferido à mão. -->

## Produção

<!-- Migration nova? Rode `npm run db:migrate` ANTES do merge. Variável nova
na Vercel? Ordem dos passos? Se não há nada, escreva "nada". -->
