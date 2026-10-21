@AGENTS.md

# Operação deste projeto (notas pro Claude Code)

`AGENTS.md` (importado acima) tem a arquitetura, as invariantes e as
convenções. Aqui fica só o que é específico de trabalhar **neste ambiente**.

## Subir o ambiente

```bash
docker start dystopia_db           # Postgres do projeto na porta 5544
npm run dev                        # :3000 (use PORT=3020 se a 3000 estiver ocupada)
npm run worker                     # em outro terminal: processa a fila/sagas
```

`.env` já aponta pro container (`localhost:5544`); a 5432 está ocupada por
outro projeto. Pra inspecionar o banco:

```bash
docker exec dystopia_db psql -U dystopia -d dystopia -c "select ..."
```

`npm test` usa um banco separado (`dystopia_test`), criado e migrado pelo
próprio runner — não encosta nos dados de dev.

## Antes de dizer que terminou

```bash
npx tsc --noEmit      # tem que ficar limpo
npm run lint          # tem que ficar limpo
npm test              # suíte inteira verde
```

E, pra mudança de fluxo, um smoke HTTP de verdade no app rodando (receita
abaixo) — teste verde com rota 500 não é entrega.

## Verificar sem navegador

Não há navegador/Playwright aqui. Então:

- **Leitura**: `curl` conferindo status + marcadores no HTML
  (`curl -s -H "Cookie: session=$JWT" localhost:3020/admin | grep -o ...`).
- **Sessão**: não precisa logar — assine um JWT com o `SESSION_SECRET` do
  `.env` no mesmo formato de `src/lib/session.ts` (`{ userId, role }`, HS256,
  `jose`) e mande como cookie `session`. Script fora do projeto precisa de
  `NODE_PATH=$PWD/node_modules npx tsx ...` e de `main()` (tsx é CJS, sem
  top-level await).
- **Escrita (Server Actions)**: dá pra chamar por `curl`:

  1. ache o id da action:
     ```bash
     grep -rho '__next_internal_action_entry_do_not_use__ \[.\{0,400\}' \
       .next/dev/server/chunks/ssr/*.js | grep -o '{"[0-9a-f]\{40,42\}":{"name":"[A-Za-z]*"}}' | sort -u
     ```
  2. `POST` numa rota que carrega a action, com `Next-Action: <id>` e corpo
     multipart;
  3. argumentos no campo `0` como JSON: valor simples inline, `undefined` →
     `"$undefined"`, `FormData` → `"$K1"` + os campos como `_1_<nome>`;
  4. **os campos `_1_*` vêm ANTES do campo `0`** — o servidor resolve o
     modelo raiz enquanto o corpo chega (busboy); `0` primeiro faz o FormData
     chegar vazio (parece "todos os campos em branco");
  5. action com `.bind(null, id)` pode ser chamada "desbindada": o argumento
     ligado vai como primeiro item de `0`.

  Resposta é `text/x-component`: o retorno aparece como JSON no stream,
  `redirect()` vira header `x-action-redirect`, erro vira HTTP 500 com a
  mensagem (só em dev).

- **Caminho triste do checkout**: suba o dev com `ALLOW_CHECKOUT_SIMULATION=1`
  e mande `simulate=decline` (ou `flaky_once`, `unavailable`) no formulário —
  é assim que se vê a compensação e o retry sem quebrar nada de verdade.

## Coisas que não fazer

- Não commitar nem dar push sem o usuário pedir.
- Não apagar o bloco `<!-- BEGIN:nextjs-agent-rules -->` do `AGENTS.md`
  (o `next dev` recria; commite junto se aparecer no diff).
- Não editar migration já aplicada — gere uma nova.
- Não adicionar dependência sem necessidade clara.
- Não mexer em `.env` (nem no `DATABASE_URL`) pra "facilitar" um teste: use
  `TEST_DATABASE_URL` ou um container descartável.
- Não presumir que o worker está rodando: o caminho inline cobre o pedido no
  request, mas retry/reconciliação só acontecem com `npm run worker`.
