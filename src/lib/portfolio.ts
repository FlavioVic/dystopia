/**
 * Portfólio de Flávio Victor — projetos públicos do GitHub (FlavioVic).
 * Imagem: captura real quando o projeto tem tela que dá para mostrar sem
 * inventar resultado; senão, diagrama da arquitetura real (`npm run art:portfolio`).
 */

export type PortfolioProject = {
  slug: string;
  code: string;
  name: string;
  kind: string;
  year: string;
  summary: string;
  highlights: string[];
  stack: string[];
  image: string;
  imageAlt: string;
  /** Captura real da aplicação (true) ou diagrama de arquitetura (false). */
  screenshot: boolean;
  repo: string;
  live?: string;
};

export const PORTFOLIO: PortfolioProject[] = [
  {
    slug: "dystopia",
    code: "DYS-P0001",
    name: "DYSTOPIA",
    kind: "E-commerce + serviços",
    year: "2026",
    summary:
      "Esta loja. Checkout orquestrado por SAGA sobre RabbitMQ com outbox transacional, compensação automática, pagamento em processo próprio e observabilidade.",
    highlights: [
      "Seis passos atômicos com compensação em ordem reversa",
      "Outbox + relay, retry por fila de espera (TTL + DLX) e DLQ",
      "Roda de graça: worker embutido na Vercel + Neon",
    ],
    stack: ["Next.js 16", "TypeScript", "PostgreSQL", "RabbitMQ", "Drizzle", "Tailwind 4"],
    image: "/portfolio/dystopia-saga.webp",
    imageAlt: "Página de pedido recusado da DYSTOPIA, com a compensação da saga passo a passo",
    screenshot: true,
    repo: "https://github.com/FlavioVic/dystopia",
    live: "https://dystopia-wheat.vercel.app",
  },
  {
    slug: "tracer",
    code: "DYS-P0002",
    name: "Tracer",
    kind: "SaaS de links com analytics",
    year: "2026",
    summary:
      "Encurtador de links com painel de analytics: de onde vieram os cliques, quando, de que dispositivo e país. Auth com refresh token rotativo e detecção de reuso.",
    highlights: [
      "Clique registrado em segundo plano, sem atrasar o redirecionamento",
      "Geolocalização offline (GeoLite2), sem API externa",
      "84 testes automatizados e CI no GitHub Actions",
    ],
    stack: ["Node.js 22", "Express 5", "Prisma 7", "React", "TanStack Query"],
    image: "/portfolio/tracer.webp",
    imageAlt: "Painel do Tracer com o gráfico de cliques por dia de um link",
    screenshot: true,
    repo: "https://github.com/FlavioVic/tracer",
    live: "https://tracer-frontend-9v53.onrender.com",
  },
  {
    slug: "gamestore-bi",
    code: "DYS-P0003",
    name: "GameStore BI",
    kind: "BI self-service com IA",
    year: "2026",
    summary:
      "Analytics em linguagem natural para uma loja de games: a pergunta em português vira SQL pelo Gemini e o resultado volta na hora. Segmentação de clientes por RFM e KMeans.",
    highlights: [
      "Arquitetura limpa (ports & adapters) no backend",
      "Validador que só deixa passar SQL de leitura",
      "Sincronização opcional com o catálogo real da Steam",
    ],
    stack: ["Python", "FastAPI", "Angular 18", "PostgreSQL", "Gemini", "scikit-learn"],
    image: "/portfolio/gamestore-bi.svg",
    imageAlt: "Diagrama da arquitetura do GameStore BI",
    screenshot: false,
    repo: "https://github.com/FlavioVic/ai-analytics-self-service",
  },
  {
    slug: "bridgekeeper",
    code: "DYS-P0004",
    name: "Bridgekeeper",
    kind: "Laboratório de segurança",
    year: "2026",
    summary:
      "Ambiente de aula prática de Gestão de Segurança da Informação: uma API atrás de um proxy NGINX, com Red Team atacando e Blue Team detectando pelos logs.",
    highlights: [
      "Ambiente inteiro sobe com um docker compose",
      "Formato de log compartilhado entre os times",
      "Fluxo de trabalho por fork e branch de cada time",
    ],
    stack: ["Node.js", "TypeScript", "NGINX", "Docker"],
    image: "/portfolio/bridgekeeper.svg",
    imageAlt: "Diagrama do laboratório Bridgekeeper: Red Team, proxy, API e Blue Team",
    screenshot: false,
    repo: "https://github.com/FlavioVic/bridgekeeper",
  },
  {
    slug: "corretor-texto",
    code: "DYS-P0005",
    name: "Corretor de texto",
    kind: "Ferramenta web",
    year: "2025",
    summary:
      "Corretor ortográfico e gramatical em português com LanguageTool. Quando o usuário confirma ou ajusta uma correção, ela vira sugestão nas próximas vezes.",
    highlights: ["LanguageTool pt-BR carregado uma vez no startup", "Histórico de correções persistido"],
    stack: ["Python", "FastAPI", "Jinja2", "LanguageTool"],
    image: "/portfolio/corretor-texto.svg",
    imageAlt: "Diagrama do corretor de texto",
    screenshot: false,
    repo: "https://github.com/FlavioVic/Algoritmo-de-correcao-de-texto",
  },
];

export const PROFILE = {
  name: "Flávio Victor",
  role: "Desenvolvedor Full Stack",
  summary:
    "Mais de 2 anos atuando em front-end, back-end e mobile. Graduando em Tecnologia em Redes de Computadores pelo IFCE.",
  github: "https://github.com/FlavioVic",
  linkedin: "https://www.linkedin.com/in/flaviovictor",
};
