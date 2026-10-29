import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { PageHeader } from "@/components/Kit";
import { PROFILE } from "@/lib/portfolio";
import { canonical } from "@/lib/seo";
import { CONTACT_EMAIL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Política de privacidade",
  description:
    "Quais dados a DYSTOPIA coleta, para quê, com quem compartilha, por quanto tempo guarda e como exercer seus direitos pela LGPD.",
  alternates: canonical("/privacidade"),
};

/**
 * Política de privacidade (LGPD, Lei 13.709/2018). Cada afirmação aqui tem que
 * bater com o código: se mudar o que o site coleta, guarda ou com quem
 * compartilha, esta página muda junto. Data da última revisão em UPDATED_AT.
 */
const UPDATED_AT = "29 de outubro de 2026";

const DATA = [
  {
    what: "Conta",
    data: "Nome, e-mail e senha. A senha é guardada só como hash bcrypt: nem a loja consegue lê-la. Cada login aberto vira um registro com a data de entrada e a validade (sem IP e sem identificar o aparelho).",
    why: "Criar a conta, entrar e mostrar seus pedidos.",
    basis: "Execução de contrato (art. 7º, V)",
  },
  {
    what: "Endereços",
    data: "Destinatário, CEP, rua, número, complemento, bairro, cidade e UF.",
    why: "Preencher a entrega dos pedidos.",
    basis: "Execução de contrato (art. 7º, V)",
  },
  {
    what: "Pedidos",
    data: "Itens, valores, cupom e forma de pagamento. No cartão, o número vai direto do seu navegador para o Stripe; a loja recebe só um identificador, nunca o número.",
    why: "Registrar o pedido, mostrar o andamento e enviar a confirmação por e-mail.",
    basis: "Execução de contrato (art. 7º, V)",
  },
  {
    what: "Pedido de orçamento",
    data: "Nome, e-mail, telefone (opcional) e a descrição que você escreve.",
    why: "Avaliar o serviço e responder com o orçamento.",
    basis: "Procedimentos preliminares a contrato, a seu pedido (art. 7º, V)",
  },
  {
    what: "Avaliações e favoritos",
    data: "Nota, título e comentário, publicados com seu primeiro nome e a inicial do sobrenome. Favoritos ficam visíveis só para você.",
    why: "Mostrar a opinião de quem comprou e guardar sua lista.",
    basis: "Consentimento: você escolhe publicar e pode apagar (art. 7º, I)",
  },
  {
    what: "Assistente",
    data: "As mensagens que você escreve no chat. Logado, o assistente consulta seus pedidos para responder sobre eles.",
    why: "Responder à pergunta. A conversa fica só no seu navegador e some ao fechar a aba; o site não grava conversas.",
    basis: "Atender ao que você pede (art. 7º, V)",
  },
  {
    what: "Endereço IP",
    data: "Usado como chave do limite de tentativas (login, cadastro, orçamento, chat, carrinho, cupom).",
    why: "Segurança: barrar força bruta e abuso. Apagado em até 48 horas.",
    basis: "Legítimo interesse em proteger o site e as contas (art. 7º, IX)",
  },
];

const PROCESSORS = [
  { name: "Vercel", role: "Hospedagem do site e registros técnicos de acesso", where: "EUA" },
  { name: "Neon", role: "Banco de dados", where: "EUA" },
  { name: "CloudAMQP", role: "Fila de mensagens entre as etapas do pedido (transitório)", where: "Nuvem do provedor" },
  { name: "Resend", role: "Envio dos e-mails de pedido e de orçamento", where: "EUA" },
  { name: "Groq", role: "Modelo de linguagem do assistente", where: "EUA" },
  { name: "Stripe", role: "Pagamento com cartão, quando ativo", where: "EUA" },
];

const RIGHTS = [
  "Confirmar se tratamos seus dados e acessá-los",
  "Corrigir dados incompletos, inexatos ou desatualizados",
  "Pedir anonimização, bloqueio ou eliminação de dados desnecessários ou tratados em desconformidade",
  "Portabilidade dos dados",
  "Eliminação dos dados tratados com consentimento",
  "Saber com quem os dados são compartilhados",
  "Saber que pode não consentir, e o que isso implica",
  "Revogar o consentimento",
  "Opor-se a tratamento feito em desacordo com a lei",
];

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="border-t border-border-faint py-8">
      <h2 id={id} className="display-4 text-[13px] text-foreground">
        {title}
      </h2>
      <div className="mt-4 flex flex-col gap-4 text-base leading-relaxed text-foreground-muted">{children}</div>
    </section>
  );
}

const mail = (
  <a href={`mailto:${CONTACT_EMAIL}`} className="break-all text-foreground underline underline-offset-4">
    {CONTACT_EMAIL}
  </a>
);

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <PageHeader
        label="Registro / LGPD"
        title="Política de privacidade"
        description="O que a DYSTOPIA guarda sobre você, por quê, com quem compartilha e como pedir para ver, corrigir ou apagar."
        meta={`Última atualização: ${UPDATED_AT}`}
      />

      <Section id="controlador" title="Quem cuida dos dados">
        <p>
          O controlador é {PROFILE.name}, responsável pelo site DYSTOPIA. O mesmo contato atende como encarregado
          (art. 41): {mail}.
        </p>
        <p>
          A loja de peças é uma demonstração técnica: o pagamento é simulado e nenhum valor é cobrado. Os dados que você
          informa nela são tratados com o mesmo cuidado que os de uma loja real.
        </p>
      </Section>

      <Section id="dados" title="O que coletamos e para quê">
        <p>Só o que você informa e o mínimo técnico para o site funcionar com segurança.</p>
        <dl className="flex flex-col border-t border-border-faint">
          {DATA.map((item) => (
            <div key={item.what} className="flex flex-col gap-1.5 border-b border-border-faint py-4">
              <dt className="font-semibold text-foreground">{item.what}</dt>
              <dd className="text-sm">{item.data}</dd>
              <dd className="text-sm">
                <span className="text-foreground">Finalidade:</span> {item.why}
              </dd>
              <dd className="text-sm">
                <span className="text-foreground">Base legal:</span> {item.basis}
              </dd>
            </div>
          ))}
        </dl>
        <p>Não vendemos dados, não fazemos perfil para publicidade e não usamos decisão automatizada sobre você.</p>
      </Section>

      <Section id="cookies" title="Cookies e armazenamento no navegador">
        <p>Só os necessários para o site funcionar, sem publicidade e sem rastreamento entre sites:</p>
        <ul className="flex list-disc flex-col gap-2 pl-5 text-sm">
          <li>
            <span className="text-foreground">session</span>: mantém você logado, por até 7 dias. Leva só um código
            aleatório, inacessível a scripts da página; ao sair, o código deixa de valer na hora, em qualquer lugar.
          </li>
          <li>
            <span className="text-foreground">cart_session</span>: guarda o carrinho de quem ainda não entrou, por até 30
            dias.
          </li>
          <li>
            <span className="text-foreground">Conversa do assistente</span>: fica no armazenamento da aba (sessionStorage)
            e some quando ela fecha.
          </li>
        </ul>
        <p>
          A medição de audiência da Vercel, quando ativa, não usa cookies e não identifica quem visita. Por serem
          estritamente necessários, esses cookies não pedem consentimento; bloqueá-los no navegador impede o login e o
          carrinho.
        </p>
      </Section>

      <Section id="compartilhamento" title="Com quem compartilhamos">
        <p>
          Com os provedores abaixo, que tratam os dados em nome da loja e só para a função de cada um (operadores, art.
          39):
        </p>
        <ul className="flex flex-col border-t border-border-faint text-sm">
          {PROCESSORS.map((p) => (
            <li key={p.name} className="flex flex-col gap-1 border-b border-border-faint py-3 sm:flex-row sm:justify-between sm:gap-6">
              <span>
                <span className="text-foreground">{p.name}</span>: {p.role}
              </span>
              <span className="label shrink-0">{p.where}</span>
            </li>
          ))}
        </ul>
        <p>
          Esses provedores ficam fora do Brasil. A transferência internacional se apoia nas garantias contratuais de
          proteção de dados que cada um oferece (art. 33). Dados também podem ser entregues a autoridade pública quando a
          lei exigir.
        </p>
      </Section>

      <Section id="retencao" title="Por quanto tempo guardamos">
        <ul className="flex list-disc flex-col gap-2 pl-5">
          <li>Conta, endereços, pedidos, avaliações e favoritos: enquanto a conta existir.</li>
          <li>
            Ao excluir a conta, tudo isso é apagado na hora, junto com os e-mails enviados a você e seus pedidos de
            orçamento. A cópia de segurança do banco guarda o histórico das últimas 6 horas; depois disso, o dado não
            existe mais em lugar nenhum.
          </li>
          <li>Pedido de orçamento sem conta: até o atendimento terminar ou até você pedir a exclusão.</li>
          <li>Endereço IP do limite de tentativas: até 48 horas.</li>
          <li>Registro de login: até você sair ou ele vencer (7 dias); os vencidos são apagados.</li>
          <li>Registros técnicos de acesso da hospedagem: pelo prazo da política da Vercel.</li>
        </ul>
      </Section>

      <Section id="direitos" title="Seus direitos">
        <p>Pela LGPD (art. 18), você pode:</p>
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm">
          {RIGHTS.map((right) => (
            <li key={right}>{right}</li>
          ))}
        </ul>
        <p>
          Logado, em{" "}
          <Link href="/conta" className="text-foreground underline underline-offset-4">
            Minha conta
          </Link>
          , você baixa todos os seus dados em JSON ou exclui a conta na hora, sem precisar pedir. Para o resto, ou se
          não tiver conta, escreva para {mail}. A resposta sai em até 15 dias.
        </p>
        <p>
          Se achar que seus dados foram tratados de forma irregular, você também pode reclamar à Autoridade Nacional de
          Proteção de Dados (
          <a href="https://www.gov.br/anpd" target="_blank" rel="noreferrer" className="text-foreground underline underline-offset-4">
            ANPD
          </a>
          ).
        </p>
      </Section>

      <Section id="seguranca" title="Segurança">
        <p>
          Conexão sempre criptografada (HTTPS com HSTS), senha guardada como hash bcrypt, sessão em cookie
          inacessível a scripts e encerrada no servidor ao sair, limite de tentativas contra força bruta, política de
          conteúdo (CSP) contra injeção de script, e painel administrativo que exige, além da senha, o código de um app
          autenticador. Se houver um incidente que possa
          causar risco ou dano relevante a você, você e a ANPD serão avisados (art. 48).
        </p>
      </Section>

      <Section id="menores" title="Crianças e adolescentes">
        <p>
          O site não é direcionado a menores de 18 anos. Se um responsável souber que um menor criou conta, basta escrever
          para {mail} que a conta é excluída.
        </p>
      </Section>

      <Section id="mudancas" title="Mudanças nesta política">
        <p>
          Quando o que o site coleta ou compartilha mudar, esta página muda junto e a data no topo é atualizada. Mudança
          que dependa de consentimento novo é pedida antes de valer.
        </p>
      </Section>
    </div>
  );
}
