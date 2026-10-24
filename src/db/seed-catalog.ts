/**
 * Inventário de demonstração: peças de PC reais, com ficha técnica de
 * fabricante e PREÇOS FICTÍCIOS. As marcas pertencem aos fabricantes; a loja
 * não vende nada (projeto de portfólio). As imagens são placas técnicas
 * desenhadas no estilo da marca (`npm run art`), não fotos de terceiros.
 *
 * `kind` escolhe o desenho da placa técnica (src/scripts/product-art.ts).
 */

import type { ProductSpec } from "./schema";

export type ArtKind =
  | "gpu"
  | "cpu"
  | "motherboard"
  | "ram"
  | "ssd"
  | "psu"
  | "case"
  | "cooler"
  | "aio"
  | "monitor"
  | "mouse"
  | "keyboard"
  | "headset";

export type SeedCategory = {
  key: string;
  name: string;
  slug: string;
  description: string;
  art: ArtKind;
};

export type SeedVariant = {
  name: string;
  sku: string;
  attributes: Record<string, string>;
  priceCents?: number;
  stockQuantity: number;
};

export type SeedProduct = {
  category: string;
  name: string;
  slug: string;
  brand: string;
  sku: string;
  art: ArtKind;
  description: string;
  priceCents: number;
  compareAtPriceCents?: number;
  stockQuantity: number;
  specs: ProductSpec[];
  variants?: SeedVariant[];
};

export const SEED_CATEGORIES: SeedCategory[] = [
  { key: "gpu", name: "Placas de vídeo", slug: "placas-de-video", art: "gpu", description: "Processamento gráfico. Registro de série obrigatório." },
  { key: "cpu", name: "Processadores", slug: "processadores", art: "cpu", description: "Unidades centrais de comando. AM5 e LGA1851." },
  { key: "mobo", name: "Placas-mãe", slug: "placas-mae", art: "motherboard", description: "A base de toda a instalação." },
  { key: "ram", name: "Memória RAM", slug: "memoria-ram", art: "ram", description: "Memória de trabalho. DDR5 e DDR4." },
  { key: "ssd", name: "Armazenamento", slug: "armazenamento", art: "ssd", description: "Nada se perde. Tudo é arquivado." },
  { key: "psu", name: "Fontes", slug: "fontes", art: "psu", description: "Alimentação certificada. Sem margem para falha." },
  { key: "case", name: "Gabinetes", slug: "gabinetes", art: "case", description: "Contenção do equipamento." },
  { key: "cool", name: "Refrigeração", slug: "refrigeracao", art: "cooler", description: "Controle térmico. Ar e líquido." },
  { key: "mon", name: "Monitores", slug: "monitores", art: "monitor", description: "Vigilância em alta taxa de atualização." },
  { key: "per", name: "Periféricos", slug: "perifericos", art: "keyboard", description: "Mouse, teclado e headset. Interfaces de comando." },
];

export const SEED_PRODUCTS: SeedProduct[] = [
  // ------------------------------------------------------------ placas de vídeo
  {
    category: "gpu",
    name: "Placa de vídeo GeForce RTX 5070 12GB",
    slug: "geforce-rtx-5070-12gb",
    brand: "NVIDIA",
    sku: "DYS-H1001",
    art: "gpu",
    description:
      "Arquitetura Blackwell com DLSS 4 e geração de quadros. Desempenho em 1440p sem concessões, consumo contido.",
    priceCents: 459990,
    compareAtPriceCents: 499990,
    stockQuantity: 18,
    specs: [
      { label: "GPU", value: "GeForce RTX 5070 (Blackwell)" },
      { label: "Memória", value: "12 GB GDDR7" },
      { label: "Barramento", value: "192 bits" },
      { label: "Núcleos CUDA", value: "6.144" },
      { label: "Interface", value: "PCIe 5.0 x16" },
      { label: "TGP", value: "250 W" },
      { label: "Fonte recomendada", value: "650 W" },
    ],
  },
  {
    category: "gpu",
    name: "Placa de vídeo GeForce RTX 5080 16GB",
    slug: "geforce-rtx-5080-16gb",
    brand: "NVIDIA",
    sku: "DYS-H1002",
    art: "gpu",
    description: "Para 4K em taxa alta e trabalho com IA local. 16 GB de GDDR7 em barramento de 256 bits.",
    priceCents: 899990,
    stockQuantity: 6,
    specs: [
      { label: "GPU", value: "GeForce RTX 5080 (Blackwell)" },
      { label: "Memória", value: "16 GB GDDR7" },
      { label: "Barramento", value: "256 bits" },
      { label: "Núcleos CUDA", value: "10.752" },
      { label: "Interface", value: "PCIe 5.0 x16" },
      { label: "TGP", value: "360 W" },
      { label: "Fonte recomendada", value: "850 W" },
    ],
  },
  {
    category: "gpu",
    name: "Placa de vídeo GeForce RTX 5060 8GB",
    slug: "geforce-rtx-5060-8gb",
    brand: "NVIDIA",
    sku: "DYS-H1003",
    art: "gpu",
    description: "Entrada na geração Blackwell. 1080p em taxa alta com DLSS 4.",
    priceCents: 239990,
    stockQuantity: 34,
    specs: [
      { label: "GPU", value: "GeForce RTX 5060 (Blackwell)" },
      { label: "Memória", value: "8 GB GDDR7" },
      { label: "Barramento", value: "128 bits" },
      { label: "Núcleos CUDA", value: "3.840" },
      { label: "Interface", value: "PCIe 5.0 x8" },
      { label: "TGP", value: "145 W" },
      { label: "Fonte recomendada", value: "550 W" },
    ],
  },
  {
    category: "gpu",
    name: "Placa de vídeo Radeon RX 9070 XT 16GB",
    slug: "radeon-rx-9070-xt-16gb",
    brand: "AMD",
    sku: "DYS-H1004",
    art: "gpu",
    description: "RDNA 4 com FSR 4 e ray tracing de nova geração. 16 GB para 1440p e 4K.",
    priceCents: 499990,
    compareAtPriceCents: 549990,
    stockQuantity: 12,
    specs: [
      { label: "GPU", value: "Radeon RX 9070 XT (RDNA 4)" },
      { label: "Memória", value: "16 GB GDDR6" },
      { label: "Barramento", value: "256 bits" },
      { label: "Unidades de computação", value: "64" },
      { label: "Interface", value: "PCIe 5.0 x16" },
      { label: "Consumo", value: "304 W" },
      { label: "Fonte recomendada", value: "750 W" },
    ],
  },

  // ------------------------------------------------------------ processadores
  {
    category: "cpu",
    name: "Processador Ryzen 7 9800X3D",
    slug: "ryzen-7-9800x3d",
    brand: "AMD",
    sku: "DYS-H2001",
    art: "cpu",
    description: "3D V-Cache de segunda geração. O processador de referência para jogos. Cooler não incluso.",
    priceCents: 389990,
    stockQuantity: 9,
    specs: [
      { label: "Soquete", value: "AM5" },
      { label: "Núcleos / threads", value: "8 / 16" },
      { label: "Clock base / boost", value: "4,7 / 5,2 GHz" },
      { label: "Cache L3", value: "96 MB" },
      { label: "TDP", value: "120 W" },
      { label: "Memória", value: "DDR5" },
    ],
  },
  {
    category: "cpu",
    name: "Processador Ryzen 5 9600X",
    slug: "ryzen-5-9600x",
    brand: "AMD",
    sku: "DYS-H2002",
    art: "cpu",
    description: "Zen 5 com seis núcleos e consumo de 65 W. Base eficiente para AM5.",
    priceCents: 169990,
    compareAtPriceCents: 189990,
    stockQuantity: 27,
    specs: [
      { label: "Soquete", value: "AM5" },
      { label: "Núcleos / threads", value: "6 / 12" },
      { label: "Clock base / boost", value: "3,9 / 5,4 GHz" },
      { label: "Cache L3", value: "32 MB" },
      { label: "TDP", value: "65 W" },
      { label: "Memória", value: "DDR5" },
    ],
  },
  {
    category: "cpu",
    name: "Processador Core Ultra 7 265K",
    slug: "core-ultra-7-265k",
    brand: "Intel",
    sku: "DYS-H2003",
    art: "cpu",
    description: "Arrow Lake com 20 núcleos híbridos e NPU integrada. Desbloqueado para overclock.",
    priceCents: 279990,
    stockQuantity: 14,
    specs: [
      { label: "Soquete", value: "LGA1851" },
      { label: "Núcleos", value: "20 (8P + 12E)" },
      { label: "Threads", value: "20" },
      { label: "Clock máximo", value: "5,5 GHz" },
      { label: "Cache", value: "30 MB" },
      { label: "Potência base", value: "125 W" },
    ],
  },
  {
    category: "cpu",
    name: "Processador Core Ultra 5 245K",
    slug: "core-ultra-5-245k",
    brand: "Intel",
    sku: "DYS-H2004",
    art: "cpu",
    description: "14 núcleos híbridos para jogo e produtividade. Gráfico integrado.",
    priceCents: 199990,
    stockQuantity: 21,
    specs: [
      { label: "Soquete", value: "LGA1851" },
      { label: "Núcleos", value: "14 (6P + 8E)" },
      { label: "Threads", value: "14" },
      { label: "Clock máximo", value: "5,2 GHz" },
      { label: "Cache", value: "24 MB" },
      { label: "Potência base", value: "125 W" },
    ],
  },

  // ------------------------------------------------------------ placas-mãe
  {
    category: "mobo",
    name: "Placa-mãe TUF Gaming B850-Plus WiFi",
    slug: "tuf-gaming-b850-plus-wifi",
    brand: "ASUS",
    sku: "DYS-H3001",
    art: "motherboard",
    description: "AM5, DDR5 e Wi-Fi 7. Construção reforçada para operação contínua.",
    priceCents: 179990,
    stockQuantity: 16,
    specs: [
      { label: "Soquete", value: "AM5" },
      { label: "Chipset", value: "AMD B850" },
      { label: "Formato", value: "ATX" },
      { label: "Memória", value: "4x DDR5" },
      { label: "M.2", value: "3 slots (1x PCIe 5.0)" },
      { label: "Rede", value: "2,5 GbE + Wi-Fi 7" },
    ],
  },
  {
    category: "mobo",
    name: "Placa-mãe MAG B860 Tomahawk WiFi",
    slug: "mag-b860-tomahawk-wifi",
    brand: "MSI",
    sku: "DYS-H3002",
    art: "motherboard",
    description: "LGA1851 para Core Ultra. VRM dimensionado para os modelos K.",
    priceCents: 189990,
    stockQuantity: 11,
    specs: [
      { label: "Soquete", value: "LGA1851" },
      { label: "Chipset", value: "Intel B860" },
      { label: "Formato", value: "ATX" },
      { label: "Memória", value: "4x DDR5" },
      { label: "M.2", value: "3 slots" },
      { label: "Rede", value: "5 GbE + Wi-Fi 7" },
    ],
  },
  {
    category: "mobo",
    name: "Placa-mãe B650M Gaming X AX",
    slug: "b650m-gaming-x-ax",
    brand: "Gigabyte",
    sku: "DYS-H3003",
    art: "motherboard",
    description: "AM5 em formato micro-ATX. A entrada correta na plataforma.",
    priceCents: 119990,
    compareAtPriceCents: 134990,
    stockQuantity: 23,
    specs: [
      { label: "Soquete", value: "AM5" },
      { label: "Chipset", value: "AMD B650" },
      { label: "Formato", value: "Micro-ATX" },
      { label: "Memória", value: "4x DDR5" },
      { label: "M.2", value: "2 slots" },
      { label: "Rede", value: "2,5 GbE + Wi-Fi 6E" },
    ],
  },

  // ------------------------------------------------------------ memória
  {
    category: "ram",
    name: "Memória Fury Beast DDR5 6000MHz CL36",
    slug: "fury-beast-ddr5-6000",
    brand: "Kingston",
    sku: "DYS-H4001",
    art: "ram",
    description: "DDR5 a 6000 MT/s com perfis EXPO e XMP. Kit em dois módulos.",
    priceCents: 64990,
    stockQuantity: 0,
    specs: [
      { label: "Tipo", value: "DDR5" },
      { label: "Frequência", value: "6000 MT/s" },
      { label: "Latência", value: "CL36" },
      { label: "Perfis", value: "AMD EXPO / Intel XMP 3.0" },
      { label: "Tensão", value: "1,35 V" },
    ],
    variants: [
      { name: "32 GB (2x16 GB)", sku: "DYS-H4001-32", attributes: { capacidade: "32 GB" }, stockQuantity: 40 },
      { name: "64 GB (2x32 GB)", sku: "DYS-H4001-64", attributes: { capacidade: "64 GB" }, priceCents: 124990, stockQuantity: 15 },
    ],
  },
  {
    category: "ram",
    name: "Memória Vengeance DDR5 6000MHz CL30",
    slug: "vengeance-ddr5-6000-cl30",
    brand: "Corsair",
    sku: "DYS-H4002",
    art: "ram",
    description: "Latência CL30 para a plataforma AM5. Dissipador de perfil baixo.",
    priceCents: 74990,
    stockQuantity: 22,
    specs: [
      { label: "Tipo", value: "DDR5" },
      { label: "Capacidade", value: "32 GB (2x16 GB)" },
      { label: "Frequência", value: "6000 MT/s" },
      { label: "Latência", value: "CL30" },
      { label: "Perfis", value: "AMD EXPO" },
    ],
  },
  {
    category: "ram",
    name: "Memória Fury Beast DDR4 3200MHz CL16",
    slug: "fury-beast-ddr4-3200",
    brand: "Kingston",
    sku: "DYS-H4003",
    art: "ram",
    description: "Para atualizar plataformas DDR4 em operação. Kit em dois módulos.",
    priceCents: 29990,
    stockQuantity: 0,
    specs: [
      { label: "Tipo", value: "DDR4" },
      { label: "Frequência", value: "3200 MT/s" },
      { label: "Latência", value: "CL16" },
      { label: "Perfis", value: "Intel XMP" },
    ],
    variants: [
      { name: "16 GB (2x8 GB)", sku: "DYS-H4003-16", attributes: { capacidade: "16 GB" }, stockQuantity: 30 },
      { name: "32 GB (2x16 GB)", sku: "DYS-H4003-32", attributes: { capacidade: "32 GB" }, priceCents: 49990, stockQuantity: 25 },
    ],
  },

  // ------------------------------------------------------------ armazenamento
  {
    category: "ssd",
    name: "SSD 990 Pro NVMe M.2",
    slug: "ssd-990-pro-nvme",
    brand: "Samsung",
    sku: "DYS-H5001",
    art: "ssd",
    description: "PCIe 4.0 no limite da interface. Controle térmico inteligente.",
    priceCents: 79990,
    stockQuantity: 0,
    specs: [
      { label: "Interface", value: "PCIe 4.0 x4 NVMe" },
      { label: "Formato", value: "M.2 2280" },
      { label: "Leitura sequencial", value: "até 7.450 MB/s" },
      { label: "Gravação sequencial", value: "até 6.900 MB/s" },
      { label: "Garantia", value: "5 anos" },
    ],
    variants: [
      { name: "1 TB", sku: "DYS-H5001-1T", attributes: { capacidade: "1 TB" }, stockQuantity: 35 },
      { name: "2 TB", sku: "DYS-H5001-2T", attributes: { capacidade: "2 TB" }, priceCents: 139990, stockQuantity: 18 },
    ],
  },
  {
    category: "ssd",
    name: "SSD WD Black SN850X 1TB NVMe M.2",
    slug: "wd-black-sn850x-1tb",
    brand: "WD",
    sku: "DYS-H5002",
    art: "ssd",
    description: "Leitura de até 7.300 MB/s com modo de jogo dedicado.",
    priceCents: 69990,
    compareAtPriceCents: 79990,
    stockQuantity: 26,
    specs: [
      { label: "Interface", value: "PCIe 4.0 x4 NVMe" },
      { label: "Formato", value: "M.2 2280" },
      { label: "Capacidade", value: "1 TB" },
      { label: "Leitura sequencial", value: "até 7.300 MB/s" },
      { label: "Garantia", value: "5 anos" },
    ],
  },
  {
    category: "ssd",
    name: "SSD NV3 1TB NVMe M.2",
    slug: "kingston-nv3-1tb",
    brand: "Kingston",
    sku: "DYS-H5003",
    art: "ssd",
    description: "Armazenamento rápido de custo controlado.",
    priceCents: 42990,
    stockQuantity: 60,
    specs: [
      { label: "Interface", value: "PCIe 4.0 x4 NVMe" },
      { label: "Formato", value: "M.2 2280" },
      { label: "Capacidade", value: "1 TB" },
      { label: "Leitura sequencial", value: "até 6.000 MB/s" },
      { label: "Garantia", value: "3 anos" },
    ],
  },

  // ------------------------------------------------------------ fontes
  {
    category: "psu",
    name: "Fonte RM850e 850W 80 Plus Gold",
    slug: "corsair-rm850e-850w",
    brand: "Corsair",
    sku: "DYS-H6001",
    art: "psu",
    description: "ATX 3.1 com conector 12V-2x6 nativo. Totalmente modular, ventoinha silenciosa.",
    priceCents: 89990,
    stockQuantity: 19,
    specs: [
      { label: "Potência", value: "850 W" },
      { label: "Certificação", value: "80 Plus Gold" },
      { label: "Padrão", value: "ATX 3.1" },
      { label: "Modularidade", value: "Totalmente modular" },
      { label: "Conector GPU", value: "12V-2x6 nativo" },
      { label: "Garantia", value: "7 anos" },
    ],
  },
  {
    category: "psu",
    name: "Fonte MAG A650BN 650W 80 Plus Bronze",
    slug: "msi-mag-a650bn-650w",
    brand: "MSI",
    sku: "DYS-H6002",
    art: "psu",
    description: "Alimentação certificada para montagens de entrada.",
    priceCents: 34990,
    stockQuantity: 44,
    specs: [
      { label: "Potência", value: "650 W" },
      { label: "Certificação", value: "80 Plus Bronze" },
      { label: "Modularidade", value: "Não modular" },
      { label: "PFC", value: "Ativo" },
      { label: "Garantia", value: "5 anos" },
    ],
  },

  // ------------------------------------------------------------ gabinetes
  {
    category: "case",
    name: "Gabinete Lancool 216",
    slug: "lian-li-lancool-216",
    brand: "Lian Li",
    sku: "DYS-H7001",
    art: "case",
    description: "Fluxo de ar frontal com duas ventoinhas de 160 mm. Vidro temperado lateral.",
    priceCents: 59990,
    stockQuantity: 13,
    specs: [
      { label: "Formato", value: "Mid tower" },
      { label: "Placas-mãe", value: "E-ATX, ATX, Micro-ATX, Mini-ITX" },
      { label: "Ventoinhas inclusas", value: "2x 160 mm + 1x 140 mm" },
      { label: "GPU máxima", value: "392 mm" },
      { label: "Radiador frontal", value: "até 360 mm" },
    ],
  },
  {
    category: "case",
    name: "Gabinete H5 Flow",
    slug: "nzxt-h5-flow",
    brand: "NZXT",
    sku: "DYS-H7002",
    art: "case",
    description: "Compacto, frente perfurada, organização de cabos sem improviso.",
    priceCents: 54990,
    compareAtPriceCents: 64990,
    stockQuantity: 17,
    specs: [
      { label: "Formato", value: "Mid tower compacto" },
      { label: "Placas-mãe", value: "ATX, Micro-ATX, Mini-ITX" },
      { label: "Ventoinhas inclusas", value: "2x 120 mm" },
      { label: "GPU máxima", value: "365 mm" },
      { label: "Radiador frontal", value: "até 280 mm" },
    ],
  },

  // ------------------------------------------------------------ refrigeração
  {
    category: "cool",
    name: "Cooler AK400",
    slug: "deepcool-ak400",
    brand: "DeepCool",
    sku: "DYS-H8001",
    art: "cooler",
    description: "Torre única com quatro heatpipes. Compatível com AM5 e LGA1851.",
    priceCents: 19990,
    stockQuantity: 52,
    specs: [
      { label: "Tipo", value: "Air cooler, torre única" },
      { label: "Heatpipes", value: "4x 6 mm" },
      { label: "Ventoinha", value: "1x 120 mm PWM" },
      { label: "TDP suportado", value: "220 W" },
      { label: "Altura", value: "155 mm" },
    ],
  },
  {
    category: "cool",
    name: "Water cooler Liquid Freezer III 360",
    slug: "arctic-liquid-freezer-iii-360",
    brand: "Arctic",
    sku: "DYS-H8002",
    art: "aio",
    description: "Radiador espesso de 360 mm e ventoinha no VRM. Para os processadores mais quentes.",
    priceCents: 64990,
    stockQuantity: 9,
    specs: [
      { label: "Tipo", value: "Water cooler AIO" },
      { label: "Radiador", value: "360 mm (38 mm de espessura)" },
      { label: "Ventoinhas", value: "3x 120 mm PWM" },
      { label: "Soquetes", value: "AM5, AM4, LGA1851, LGA1700" },
      { label: "Garantia", value: "6 anos" },
    ],
  },

  // ------------------------------------------------------------ monitores
  {
    category: "mon",
    name: 'Monitor UltraGear 27" QHD 180Hz IPS',
    slug: "lg-ultragear-27-qhd-180hz",
    brand: "LG",
    sku: "DYS-H9001",
    art: "monitor",
    description: "2560 x 1440 a 180 Hz em painel IPS de 1 ms. O ponto de equilíbrio.",
    priceCents: 179990,
    compareAtPriceCents: 199990,
    stockQuantity: 15,
    specs: [
      { label: "Tamanho", value: '27"' },
      { label: "Resolução", value: "2560 x 1440 (QHD)" },
      { label: "Taxa de atualização", value: "180 Hz" },
      { label: "Painel", value: "IPS" },
      { label: "Tempo de resposta", value: "1 ms (GtG)" },
      { label: "Entradas", value: "2x HDMI 2.0, 1x DisplayPort 1.4" },
    ],
  },
  {
    category: "mon",
    name: 'Monitor 24G2SP 24" Full HD 165Hz IPS',
    slug: "aoc-24g2sp-24-165hz",
    brand: "AOC",
    sku: "DYS-H9002",
    art: "monitor",
    description: "Full HD a 165 Hz. Para quem precisa de taxa alta sem gastar demais.",
    priceCents: 89990,
    stockQuantity: 38,
    specs: [
      { label: "Tamanho", value: '23,8"' },
      { label: "Resolução", value: "1920 x 1080 (Full HD)" },
      { label: "Taxa de atualização", value: "165 Hz" },
      { label: "Painel", value: "IPS" },
      { label: "Tempo de resposta", value: "1 ms (MPRT)" },
    ],
  },

  // ------------------------------------------------------------ periféricos
  {
    category: "per",
    name: "Mouse sem fio G Pro X Superlight 2",
    slug: "logitech-g-pro-x-superlight-2",
    brand: "Logitech",
    sku: "DYS-H9101",
    art: "mouse",
    description: "60 g, sensor HERO 2 e polling de até 8 kHz. Sem fio, sem atraso.",
    priceCents: 89990,
    stockQuantity: 24,
    specs: [
      { label: "Conexão", value: "Sem fio LIGHTSPEED / USB-C" },
      { label: "Sensor", value: "HERO 2, até 32.000 DPI" },
      { label: "Peso", value: "60 g" },
      { label: "Bateria", value: "até 95 h" },
    ],
  },
  {
    category: "per",
    name: "Teclado mecânico Kumara K552",
    slug: "redragon-kumara-k552",
    brand: "Redragon",
    sku: "DYS-H9102",
    art: "keyboard",
    description: "TKL com switches mecânicos e chassi metálico. Resiste ao uso intenso.",
    priceCents: 19990,
    compareAtPriceCents: 24990,
    stockQuantity: 70,
    specs: [
      { label: "Formato", value: "TKL (87 teclas)" },
      { label: "Switch", value: "Mecânico Outemu Red" },
      { label: "Layout", value: "ABNT2" },
      { label: "Conexão", value: "USB" },
    ],
  },
  {
    category: "per",
    name: "Headset Cloud III",
    slug: "hyperx-cloud-iii",
    brand: "HyperX",
    sku: "DYS-H9103",
    art: "headset",
    description: "Drivers de 53 mm e microfone removível com cancelamento de ruído.",
    priceCents: 59990,
    stockQuantity: 31,
    specs: [
      { label: "Drivers", value: "53 mm" },
      { label: "Conexão", value: "USB-C, USB-A e P2" },
      { label: "Microfone", value: "Removível, cancelamento de ruído" },
      { label: "Áudio", value: "DTS Headphone:X" },
    ],
  },
];
