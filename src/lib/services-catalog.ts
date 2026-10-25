/**
 * Os serviços prestados — fonte única para a página /servicos, o rodapé, o
 * formulário de orçamento e o admin. `kind` é o valor do enum `service_kind`
 * no banco.
 */

export type ServiceKind = "desenvolvimento" | "montagem" | "manutencao" | "formatacao";

export type Service = {
  kind: ServiceKind;
  serial: string;
  name: string;
  summary: string;
  scope: string[];
};

export const SERVICES: Service[] = [
  {
    kind: "montagem",
    serial: "DYS-S0001",
    name: "Montagem de computadores",
    summary: "Você escolhe as peças, ou elas são escolhidas para você. A máquina sai montada, testada e registrada.",
    scope: [
      "Seleção de peças por orçamento e uso",
      "Montagem com organização de cabos",
      "BIOS atualizada e memória no perfil correto (EXPO/XMP)",
      "Teste de estresse e laudo térmico",
    ],
  },
  {
    kind: "manutencao",
    serial: "DYS-S0002",
    name: "Manutenção",
    summary: "Diagnóstico, limpeza e reparo. Nenhuma falha permanece sem registro.",
    scope: [
      "Diagnóstico de falhas de hardware",
      "Limpeza interna e troca de pasta térmica",
      "Substituição de componentes",
      "Upgrade de peças",
    ],
  },
  {
    kind: "formatacao",
    serial: "DYS-S0003",
    name: "Formatação",
    summary: "O sistema é reinstalado do zero. Seus arquivos são preservados antes de qualquer intervenção.",
    scope: [
      "Backup dos arquivos antes da formatação",
      "Instalação do Windows ou Linux",
      "Drivers e atualizações aplicados",
      "Programas essenciais instalados",
    ],
  },
  {
    kind: "desenvolvimento",
    serial: "DYS-S0004",
    name: "Desenvolvimento de software",
    summary: "Sistemas web, lojas e integrações. Construídos para durar e para serem auditados.",
    scope: [
      "Sites e lojas virtuais",
      "Sistemas web sob medida",
      "APIs e integrações entre sistemas",
      "Automação de processos",
    ],
  },
];

export const SERVICE_KINDS = SERVICES.map((s) => s.kind);

export function serviceName(kind: string): string {
  return SERVICES.find((s) => s.kind === kind)?.name ?? kind;
}

export function isServiceKind(value: string): value is ServiceKind {
  return (SERVICE_KINDS as string[]).includes(value);
}

/** Como um serviço anda, do pedido à entrega (home e /servicos). */
export const PROCESS = [
  { step: "01", title: "Solicitação", text: "Você descreve a necessidade. Um protocolo é emitido." },
  { step: "02", title: "Diagnóstico", text: "O escopo é avaliado e o orçamento é enviado por escrito." },
  { step: "03", title: "Execução", text: "Nada começa sem aprovação. O andamento é registrado." },
  { step: "04", title: "Entrega", text: "Equipamento ou sistema entregue com laudo do que foi feito." },
];

/**
 * Perguntas frequentes de /servicos (também viram FAQPage no JSON-LD e o
 * /llms.txt). Só o que o site já garante em outro lugar — nada de promessa nova.
 */
export const SERVICE_FAQ = [
  {
    question: "O orçamento tem custo?",
    answer: "Não. Todo serviço começa com um orçamento sem custo, enviado por escrito depois do diagnóstico.",
  },
  {
    question: "Como peço um orçamento?",
    answer:
      "Pelo formulário da página de serviços ou pelo assistente do site. Cada pedido recebe um protocolo (DYS-S…) e o retorno é feito pelo e-mail informado.",
  },
  {
    question: "O serviço começa antes da minha aprovação?",
    answer: "Não. Nada é executado sem a aprovação do orçamento, e o andamento fica registrado até a entrega.",
  },
  {
    question: "Perco meus arquivos na formatação?",
    answer: "Não. Os arquivos são copiados antes de qualquer intervenção, e só então o Windows ou o Linux é reinstalado.",
  },
  {
    question: "O que recebo na entrega?",
    answer:
      "O equipamento ou sistema com o laudo do que foi feito. Na montagem, a máquina sai com BIOS atualizada, teste de estresse e laudo térmico.",
  },
  {
    question: "A loja de peças vende de verdade?",
    answer:
      "Não. A loja é uma demonstração técnica do portfólio: o pagamento é simulado e nenhum valor é cobrado. Os serviços são reais.",
  },
];

/** O que passa na faixa da home: serviços e o ferramental usado neles. */
export const TICKER = [
  "Desenvolvimento web",
  "APIs e integrações",
  "Montagem de PCs",
  "Manutenção",
  "Formatação",
  "Next.js",
  "TypeScript",
  "Python",
  "PostgreSQL",
  "Docker",
  "React",
  "FastAPI",
];
