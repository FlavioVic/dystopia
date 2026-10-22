/**
 * Seed de dados do Dystopia.
 *
 * Roda com: npm run db:seed
 *
 * Idempotente o suficiente pra dev local: limpa as tabelas relevantes antes
 * de inserir de novo (TRUNCATE ... CASCADE), então pode rodar quantas vezes
 * quiser sem duplicar.
 *
 * Os nomes de produto são fictícios/genéricos (não usam marcas registradas
 * de terceiros) — a ideia é ilustrar o catálogo, não vender licenciados reais.
 */

import "dotenv/config";
import bcrypt from "bcryptjs";
import { db } from "./index";
import {
  categories,
  products,
  productImages,
  productVariants,
  users,
  addresses,
  coupons,
  reviews,
} from "./schema";
import { sql } from "drizzle-orm";

// Categorias usam SVGs locais; produtos usam fotos reais (JPEG) em
// public/images/products/<slug>.jpg — fotos de stock livres (Pexels, uso
// comercial sem atribuição), uma por produto.
function categoryImage(slug: string) {
  return `/images/categories/${slug}.svg`;
}

function productImage(slug: string) {
  return `/images/products/${slug}.jpg`;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * O seed apaga tudo e cria um admin. Contra o banco local isso é conveniência;
 * contra um banco remoto (produção/demo) seria apagar pedidos reais e criar um
 * admin com a senha que está no README público. Então, fora do localhost:
 * exige confirmação explícita e senha de admin vinda do ambiente.
 */
function resolveSeedCredentials(): { adminPassword: string; customerPassword: string; remote: boolean } {
  const host = new URL(process.env.DATABASE_URL!).hostname;
  const remote = !LOCAL_HOSTS.has(host);
  if (!remote) {
    return {
      adminPassword: process.env.SEED_ADMIN_PASSWORD ?? "admin123",
      customerPassword: process.env.SEED_CUSTOMER_PASSWORD ?? "cliente123",
      remote,
    };
  }

  if (process.env.SEED_ALLOW_REMOTE !== "1") {
    throw new Error(
      `DATABASE_URL aponta pra um banco remoto (${host}) e o seed faz TRUNCATE em tudo. ` +
        "Se é isso mesmo, rode com SEED_ALLOW_REMOTE=1.",
    );
  }
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "";
  if (adminPassword.length < 16) {
    throw new Error("Banco remoto: defina SEED_ADMIN_PASSWORD com pelo menos 16 caracteres.");
  }
  // A conta de cliente é a demo pública (quem visita o portfólio entra com ela);
  // ela não tem poder nenhum além do que um cadastro novo já teria.
  return { adminPassword, customerPassword: process.env.SEED_CUSTOMER_PASSWORD ?? "cliente123", remote };
}

async function main() {
  const credentials = resolveSeedCredentials();

  console.log("🧹 Limpando tabelas...");
  await db.execute(sql`
    TRUNCATE TABLE
      notifications, saga_steps, sagas, jobs,
      wishlist_items, reviews, payments, order_items, orders,
      cart_items, carts, coupons, product_variants, product_images,
      products, categories, addresses, users
    RESTART IDENTITY CASCADE
  `);

  console.log("📁 Criando categorias...");
  const [
    catColecionaveis,
    catQuadrinhos,
    catGames,
    catRoupas,
    catAcessorios,
    catPapelaria,
  ] = await db
    .insert(categories)
    .values([
      {
        name: "Colecionáveis & Action Figures",
        slug: "colecionaveis-action-figures",
        description: "Estátuas, action figures e itens de coleção geek.",
        imageUrl: categoryImage("colecionaveis-action-figures"),
      },
      {
        name: "Quadrinhos & HQs",
        slug: "quadrinhos-hqs",
        description: "Edições, box sets e artbooks.",
        imageUrl: categoryImage("quadrinhos-hqs"),
      },
      {
        name: "Games & Consoles",
        slug: "games-consoles",
        description: "Jogos, acessórios de controle e itens retrô.",
        imageUrl: categoryImage("games-consoles"),
      },
      {
        name: "Roupas & Moda Geek",
        slug: "roupas-moda-geek",
        description: "Camisetas, moletons e jaquetas com estampas geek.",
        imageUrl: categoryImage("roupas-moda-geek"),
      },
      {
        name: "Acessórios Geek",
        slug: "acessorios-geek",
        description: "Canecas, chaveiros, pins e itens de mesa.",
        imageUrl: categoryImage("acessorios-geek"),
      },
      {
        name: "Papelaria & Gadgets",
        slug: "papelaria-gadgets",
        description: "Cadernos, luminárias e pequenos gadgets temáticos.",
        imageUrl: categoryImage("papelaria-gadgets"),
      },
    ])
    .returning();

  console.log("📦 Criando produtos...");

  type SeedProduct = {
    categoryId: string;
    name: string;
    slug: string;
    description: string;
    brand: string;
    sku: string;
    priceCents: number;
    compareAtPriceCents?: number;
    stockQuantity: number;
    isFeatured?: boolean;
    variants?: { name: string; sku: string; attributes: Record<string, string>; priceCents?: number; stockQuantity: number }[];
  };

  const seedProducts: SeedProduct[] = [
    {
      categoryId: catColecionaveis.id,
      name: "Action Figure Ciborgue Ronin 2088",
      slug: "action-figure-ciborgue-ronin-2088",
      description:
        "Figure articulada de 18cm inspirada em guerreiros ciborgues de um futuro neon-distópico. Base iluminada por LED (2x pilhas AAA inclusas).",
      brand: "Dystopia Originals",
      sku: "DYS-AF-001",
      priceCents: 24990,
      compareAtPriceCents: 29990,
      stockQuantity: 35,
      isFeatured: true,
    },
    {
      categoryId: catColecionaveis.id,
      name: "Estátua Resina Oráculo das Máquinas",
      slug: "estatua-resina-oraculo-das-maquinas",
      description:
        "Estátua em resina premium, 25cm, tiragem limitada numerada (1/500), com certificado de autenticidade.",
      brand: "Dystopia Collectibles",
      sku: "DYS-ST-002",
      priceCents: 54990,
      stockQuantity: 12,
      isFeatured: true,
    },
    {
      categoryId: catColecionaveis.id,
      name: "Mini Figures Esquadrão Néon (Blind Box)",
      slug: "mini-figures-esquadrao-neon-blind-box",
      description:
        "Caixa surpresa com 1 de 8 mini figures colecionáveis do universo Dystopia. Qual você vai tirar?",
      brand: "Dystopia Originals",
      sku: "DYS-BB-003",
      priceCents: 4990,
      stockQuantity: 200,
    },
    {
      categoryId: catQuadrinhos.id,
      name: "HQ: Crônicas de Neo-Babel #1",
      slug: "hq-cronicas-de-neo-babel-1",
      description:
        "Primeira edição da saga cyberpunk mais aclamada do ano. Capa variante holográfica.",
      brand: "Editora Distopia",
      sku: "DYS-HQ-004",
      priceCents: 3490,
      stockQuantity: 80,
    },
    {
      categoryId: catQuadrinhos.id,
      name: "Box Set Completo: Trilogia Overclock",
      slug: "box-set-trilogia-overclock",
      description:
        "Os 3 volumes da trilogia em capa dura, com box ilustrado e pôster exclusivo.",
      brand: "Editora Distopia",
      sku: "DYS-HQ-005",
      priceCents: 18990,
      compareAtPriceCents: 22990,
      stockQuantity: 25,
      isFeatured: true,
    },
    {
      categoryId: catQuadrinhos.id,
      name: "Artbook: Visões de uma Cidade Elétrica",
      slug: "artbook-visoes-de-uma-cidade-eletrica",
      description:
        "180 páginas de concept art, capa dura, papel fosco premium.",
      brand: "Editora Distopia",
      sku: "DYS-AB-006",
      priceCents: 12990,
      stockQuantity: 40,
    },
    {
      categoryId: catGames.id,
      name: "Jogo de Tabuleiro: Protocolo Insurgente",
      slug: "jogo-de-tabuleiro-protocolo-insurgente",
      description:
        "Board game estratégico pra 2-5 jogadores, ambientado numa megacidade dominada por corporações. 90-120 min por partida.",
      brand: "Dystopia Games",
      sku: "DYS-BG-007",
      priceCents: 29990,
      stockQuantity: 30,
      isFeatured: true,
    },
    {
      categoryId: catGames.id,
      name: "Controle Retrô Wireless Edição Neon",
      slug: "controle-retro-wireless-edicao-neon",
      description:
        "Compatível com PC e principais consoles via Bluetooth. Design retrô com detalhes em neon.",
      brand: "Dystopia Tech",
      sku: "DYS-CT-008",
      priceCents: 19990,
      stockQuantity: 60,
      variants: [
        { name: "Roxo Neon", sku: "DYS-CT-008-PUR", attributes: { color: "Roxo Neon" }, stockQuantity: 25 },
        { name: "Verde Neon", sku: "DYS-CT-008-GRN", attributes: { color: "Verde Neon" }, stockQuantity: 20 },
        { name: "Rosa Neon", sku: "DYS-CT-008-PNK", attributes: { color: "Rosa Neon" }, stockQuantity: 15 },
      ],
    },
    {
      categoryId: catGames.id,
      name: "Mousepad Gamer XXL Skyline Noturno",
      slug: "mousepad-gamer-xxl-skyline-noturno",
      description: "90x40cm, base emborrachada antiderrapante, bordas costuradas.",
      brand: "Dystopia Tech",
      sku: "DYS-MP-009",
      priceCents: 8990,
      stockQuantity: 90,
    },
    {
      categoryId: catRoupas.id,
      name: "Camiseta Grid da Cidade",
      slug: "camiseta-grid-da-cidade",
      description: "100% algodão, estampa serigrafada, corte unissex.",
      brand: "Dystopia Wear",
      sku: "DYS-CM-010",
      priceCents: 8990,
      stockQuantity: 150,
      isFeatured: true,
      variants: [
        { name: "P", sku: "DYS-CM-010-P", attributes: { size: "P" }, stockQuantity: 40 },
        { name: "M", sku: "DYS-CM-010-M", attributes: { size: "M" }, stockQuantity: 50 },
        { name: "G", sku: "DYS-CM-010-G", attributes: { size: "G" }, stockQuantity: 40 },
        { name: "GG", sku: "DYS-CM-010-GG", attributes: { size: "GG" }, stockQuantity: 20 },
      ],
    },
    {
      categoryId: catRoupas.id,
      name: "Moletom Circuito Urbano",
      slug: "moletom-circuito-urbano",
      description: "Moletom canguru com forro, estampa de circuito refletiva.",
      brand: "Dystopia Wear",
      sku: "DYS-MT-011",
      priceCents: 15990,
      compareAtPriceCents: 18990,
      stockQuantity: 70,
      variants: [
        { name: "P", sku: "DYS-MT-011-P", attributes: { size: "P" }, stockQuantity: 15 },
        { name: "M", sku: "DYS-MT-011-M", attributes: { size: "M" }, stockQuantity: 25 },
        { name: "G", sku: "DYS-MT-011-G", attributes: { size: "G" }, stockQuantity: 20 },
        { name: "GG", sku: "DYS-MT-011-GG", attributes: { size: "GG" }, stockQuantity: 10 },
      ],
    },
    {
      categoryId: catRoupas.id,
      name: "Jaqueta Corta-Vento Runner Noturno",
      slug: "jaqueta-corta-vento-runner-noturno",
      description: "Impermeável leve, detalhes refletivos, bolso interno.",
      brand: "Dystopia Wear",
      sku: "DYS-JK-012",
      priceCents: 24990,
      stockQuantity: 45,
    },
    {
      categoryId: catAcessorios.id,
      name: "Caneca Térmica Circuito Neon",
      slug: "caneca-termica-circuito-neon",
      description: "Aço inox, muda de cor com líquido quente, 400ml.",
      brand: "Dystopia Home",
      sku: "DYS-CN-013",
      priceCents: 6990,
      stockQuantity: 120,
      isFeatured: true,
    },
    {
      categoryId: catAcessorios.id,
      name: "Kit 5 Pins Esmaltados Ícones da Megacidade",
      slug: "kit-5-pins-esmaltados-icones-da-megacidade",
      description: "Pins em metal com esmalte duro, ótimo pra jaqueta ou mochila.",
      brand: "Dystopia Originals",
      sku: "DYS-PN-014",
      priceCents: 5990,
      stockQuantity: 200,
    },
    {
      categoryId: catAcessorios.id,
      name: "Chaveiro LED Sinal de Rua Corp.",
      slug: "chaveiro-led-sinal-de-rua-corp",
      description: "Miniatura de placa de rua futurista com luz LED embutida.",
      brand: "Dystopia Originals",
      sku: "DYS-CH-015",
      priceCents: 3990,
      stockQuantity: 150,
    },
    {
      categoryId: catAcessorios.id,
      name: "Mochila Tática Urbana Dystopia",
      slug: "mochila-tatica-urbana-dystopia",
      description: "Compartimento acolchoado pra notebook 15\", tecido resistente à água.",
      brand: "Dystopia Gear",
      sku: "DYS-MC-016",
      priceCents: 29990,
      stockQuantity: 55,
      isFeatured: true,
    },
    {
      categoryId: catPapelaria.id,
      name: "Caderno Capa Dura Manifesto Cyberpunk",
      slug: "caderno-capa-dura-manifesto-cyberpunk",
      description: "192 páginas pautadas, elástico e fita marcadora.",
      brand: "Dystopia Home",
      sku: "DYS-CD-017",
      priceCents: 4990,
      stockQuantity: 180,
    },
    {
      categoryId: catPapelaria.id,
      name: "Luminária LED Logo Corporação Fictícia",
      slug: "luminaria-led-logo-corporacao-ficticia",
      description: "Luminária de mesa USB, 3 tons de luz, acrílico com gravação a laser.",
      brand: "Dystopia Home",
      sku: "DYS-LM-018",
      priceCents: 11990,
      stockQuantity: 65,
    },
    {
      categoryId: catPapelaria.id,
      name: "Pôster Metálico Cidade Neon 2088",
      slug: "poster-metalico-cidade-neon-2088",
      description: "Impressão em placa metálica 30x45cm, acabamento fosco.",
      brand: "Dystopia Home",
      sku: "DYS-PS-019",
      priceCents: 7990,
      stockQuantity: 100,
    },
    {
      categoryId: catPapelaria.id,
      name: "Mouse Gamer RGB Sombra Digital",
      slug: "mouse-gamer-rgb-sombra-digital",
      description: "6400 DPI ajustável, iluminação RGB customizável, 6 botões programáveis.",
      brand: "Dystopia Tech",
      sku: "DYS-MS-020",
      priceCents: 13990,
      compareAtPriceCents: 16990,
      stockQuantity: 75,
    },
  ];

  for (const p of seedProducts) {
    const [inserted] = await db
      .insert(products)
      .values({
        categoryId: p.categoryId,
        name: p.name,
        slug: p.slug,
        description: p.description,
        brand: p.brand,
        sku: p.sku,
        priceCents: p.priceCents,
        compareAtPriceCents: p.compareAtPriceCents,
        stockQuantity: p.stockQuantity,
        isFeatured: p.isFeatured ?? false,
      })
      .returning();

    await db.insert(productImages).values([
      { productId: inserted.id, url: productImage(p.slug), altText: p.name, position: 0 },
    ]);

    if (p.variants?.length) {
      await db.insert(productVariants).values(
        p.variants.map((v) => ({
          productId: inserted.id,
          name: v.name,
          sku: v.sku,
          priceCents: v.priceCents ?? null,
          stockQuantity: v.stockQuantity,
          attributes: v.attributes,
        })),
      );
    }
  }

  console.log("👤 Criando usuários de teste...");
  const adminPasswordHash = await bcrypt.hash(credentials.adminPassword, 10);
  const customerPasswordHash = await bcrypt.hash(credentials.customerPassword, 10);

  await db
    .insert(users)
    .values({
      email: "admin@dystopia.dev",
      passwordHash: adminPasswordHash,
      name: "Admin Dystopia",
      role: "admin",
    })
    .returning();

  const [customer] = await db
    .insert(users)
    .values({
      email: "cliente@dystopia.dev",
      passwordHash: customerPasswordHash,
      name: "Cliente Teste",
      role: "customer",
    })
    .returning();

  await db.insert(addresses).values({
    userId: customer.id,
    label: "Casa",
    recipientName: "Cliente Teste",
    street: "Rua das Distopias",
    number: "404",
    neighborhood: "Centro",
    city: "São Paulo",
    state: "SP",
    zipCode: "01000-000",
    country: "BR",
    isDefault: true,
  });

  console.log("🏷️  Criando cupom de exemplo...");
  await db.insert(coupons).values({
    code: "BEMVINDO10",
    description: "10% de desconto na primeira compra",
    discountType: "percentage",
    discountValue: 10,
    minOrderCents: 5000,
    maxUsage: 500,
    validFrom: new Date(),
  });

  console.log("⭐ Criando reviews de exemplo...");
  const allProducts = await db.select().from(products).limit(5);
  for (const prod of allProducts) {
    await db.insert(reviews).values({
      productId: prod.id,
      userId: customer.id,
      rating: 5,
      title: "Produto excelente",
      comment: "Chegou rápido e a qualidade surpreendeu. Recomendo!",
      isVerifiedPurchase: true,
    });
  }

  console.log("✅ Seed concluído!");
  console.log(`   ${seedProducts.length} produtos em 6 categorias`);
  // Em banco remoto a senha de admin não vai pro log (log de CI/terminal vaza).
  const adminShown = credentials.remote ? "(SEED_ADMIN_PASSWORD)" : credentials.adminPassword;
  console.log(`   Login admin: admin@dystopia.dev / ${adminShown}`);
  console.log(`   Login cliente: cliente@dystopia.dev / ${credentials.customerPassword}`);
}

main()
  .catch((err) => {
    console.error("❌ Erro no seed:", err);
    process.exit(1);
  })
  .finally(() => process.exit(0));
