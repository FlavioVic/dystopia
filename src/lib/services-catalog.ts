/**
 * Os serviços prestados — fonte única pra página /servicos, o rodapé, o
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
