# Funcionalidades, identidade e modelagem

# Identidade visual

O design system "DYSTOPIA" trata a marca como uma instituição que já é dona da
cidade: contenção, disciplina, permanência. No código, isso vira regra:

- **Cinco cores** (`globals.css`): obsidian e graphite no fundo, steel e bone
  no neutro e **signal-red como cor de ação** — botões, faixas, índices, estado
  ativo. Texto vermelho pequeno usa um tom mais claro (`signal-text`, 5,5:1) para
  passar contraste. Sem gradiente, brilho ou sombra; camadas se separam por régua.
- **Cantos retos** em tudo (os raios do Tailwind são zerados no tema).
- **Tipografia**: Michroma em caixa alta para nomear, Inter Tight para ler, IBM
  Plex Mono para código, serial, preço e rótulo — auto-hospedadas.
- **Marca desenhada**, nunca digitada: o emblema "The Gate" e o nome vêm da
  geometria original (`src/lib/brand-geometry.ts`, `src/components/Logo.tsx`).
- **Voz** declarativa e sem exclamação ("A ordem é um serviço.", "Aquisição
  registrada."). Estado é dito por palavra num rótulo, não só por cor.
- **Imagens de produto**: foto real quando a Wikimedia Commons tem o **modelo
  exato** sob licença livre (com crédito na página do produto e em `/creditos`);
  senão, placa técnica gerada (`npm run art`). Nunca foto de outro modelo.
- **Movimento** mecânico e curto: blocos revelados ao rolar, o emblema montado
  na abertura (a vinheta do design system), faixa contínua, contadores e linha
  vermelha no hover — tudo desligado com `prefers-reduced-motion`.

O kit da linguagem gráfica (régua com índice, rótulo de classificação, botões,
grade com régua, campos de formulário) mora em `src/components/Kit.tsx`.

# Conta do cliente

| Rota | O que faz |
|---|---|
| `/conta` | Dados da conta e histórico de pedidos (com o status real de cada um) |
| `/conta/enderecos` | Agenda de endereços: cadastrar, definir padrão, remover |
| `/conta/seguranca` | Quantas sessões estão abertas e "sair dos outros aparelhos"; para o admin, o autenticador (cadastro por QR, códigos de recuperação, trocar de celular) |
| `/favoritos` | Arquivo de favoritos ("Salvar" na vitrine e na página do produto) |

- **Avaliações**: quem está logado avalia direto na página do produto (1 a 5
  estrelas, título e comentário opcionais). Uma avaliação por pessoa por
  produto — reenviar edita a sua. Quem já comprou o item ganha o selo *compra
  verificada* (checado contra pedidos pagos), e a média/contagem do produto são
  recalculadas na mesma transação da escrita.
- **Endereços**: o endereço digitado no checkout entra na agenda, e os salvos
  aparecem como opção no próximo pedido. Endereço usado em pedido não pode ser
  removido (a FK é `RESTRICT` de propósito) — a interface explica em vez de
  estourar erro.
- **Favoritos**: o "Salvar" aparece em toda a vitrine com **uma** query por
  request (React `cache()` + um componente de servidor que resolve o estado),
  não uma por card.

# Assistente

Botão fixo no canto da loja que abre uma conversa com um modelo de linguagem
(Groq, plano grátis). Ele não "sabe" o catálogo de cor: consulta o sistema por
ferramentas, como uma tela faria.

- **Busca produtos** por termo, categoria e preço máximo ("placa de vídeo até
  R$ 3.000"), com estoque primeiro e link para a página do produto.
- **Pedidos** da pessoa logada (lista e detalhe). Visitante é mandado entrar; o
  dono do pedido vem da sessão, nunca da conversa.
- **Orçamento de serviço**: coleta os dados, mostra o resumo, e só registra
  depois do "sim" — pelo mesmo fluxo e limite do formulário de /servicos.
- **Dúvidas e suporte**: frete, pagamento, cupons ativos, conta e carrinho, a
  partir das mesmas constantes que o checkout usa.

Proteções: limite de mensagens por IP, só chamada da própria página, histórico
com teto de tamanho, link só para página do site, conversa guardada só na aba
(`sessionStorage`). Limite do provedor estourado vira "tente de novo em N s".

# Painel admin

Entre com o usuário admin do seed e acesse [`/admin`](http://localhost:3000/admin)
(o link também aparece em `/conta`). Visitante ou cliente que tentar entrar é
redirecionado para `/entrar`, e as Server Actions do painel checam papel e MFA
antes de escrever.

**Duas etapas obrigatórias.** O painel exige senha + código de um app
autenticador (TOTP). No primeiro login, o admin é mandado para
`/conta/seguranca`: escaneia o QR, confirma com o primeiro código e recebe 10
códigos de recuperação (uso único, só aparecem uma vez). Nos logins seguintes,
depois da senha vem `/entrar/verificacao`; até digitar o código, a sessão não
vale como login para nada. Só o admin tem MFA: a conta demo de cliente tem
senha pública, e quem ligasse MFA nela trancaria os outros visitantes para
fora.

| Rota | O que faz |
|---|---|
| `/admin` | Receita, nº de pedidos, produtos ativos, estoque baixo + últimos pedidos |
| `/admin/pedidos` | Todos os pedidos (cliente, data, itens, status, total) |
| `/admin/pedidos/[orderNumber]` | Itens, totais, endereço, pagamento, troca de status e a saga do pedido |
| `/admin/produtos` | Lista com preço/estoque e toggles de "ativo" e "destaque" |
| `/admin/produtos/novo` · `/admin/produtos/[id]` | Criar e editar produto, com variantes (tamanho/cor, SKU, preço e estoque próprios) |
| `/admin/cupons` · `/admin/cupons/novo` · `/admin/cupons/[id]` | Cupons: percentual ou valor fixo, pedido mínimo, limite de usos e validade |
| `/admin/orquestracao` | Sagas, filas do RabbitMQ, outbox, DLQ (com reprocessamento), notificações e reconciliação |

# Modelagem do banco

19 tabelas: 15 do domínio (loja e serviços) + 4 da orquestração.

| Domínio | Tabelas |
|---|---|
| Usuários | `users`, `addresses` |
| Catálogo | `categories`, `products`, `product_images`, `product_variants` |
| Carrinho | `carts`, `cart_items` |
| Pedidos | `orders`, `order_items`, `payments`, `coupons` |
| Social | `reviews`, `wishlist_items` |
| Serviços | `service_requests` |
| Orquestração | `sagas`, `saga_steps`, `outbox`, `notifications` |

Decisões de design:

- **Preços em centavos** (`integer`) em vez de float, para evitar erro de arredondamento.
- **Snapshots de preço** em `cart_items` e `order_items` — o preço do produto pode mudar depois da compra, então guardamos o valor no momento da operação.
- **Ficha técnica em lista** (`products.specs` é `jsonb` com `[{ label, value }]`) — a ordem de exibição importa e cada categoria tem rótulos próprios (VRAM, soquete, TDP…).
- **Variantes flexíveis** (`product_variants.attributes` é `jsonb`) — um produto pode ter tamanho, cor, ou nenhuma variação, sem precisar de colunas fixas para cada atributo possível.
- **Categorias hierárquicas** (`categories.parent_id` auto-referenciado) — dá para ter subcategorias no futuro sem migrar o schema de novo.
- **Carrinho de visitante** (`carts.session_token` nullable junto de `user_id` nullable) — permite carrinho antes do login.
- **Status de pedido é máquina de estados** (`src/lib/order-status.ts`): "entregue → pendente" não existe, nem no admin nem na saga.
- **Chave de idempotência no pagamento** (`payments.idempotency_key`, unique) — reexecutar o passo não cria segunda cobrança.
- Ver o schema completo comentado em [`src/db/schema.ts`](./src/db/schema.ts).
