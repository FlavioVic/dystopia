/**
 * Seed de dados da DYSTOPIA.
 *
 * Roda com: npm run db:seed
 *
 * Idempotente o suficiente pra dev local: limpa as tabelas relevantes antes
 * de inserir de novo (TRUNCATE ... CASCADE), então pode rodar quantas vezes
 * quiser sem duplicar.
 *
 * O inventário (peças reais, preços fictícios) mora em ./seed-catalog.ts.
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
import { PRODUCT_PHOTOS } from "@/lib/photo-credits";
import { recalculateProductRating } from "@/services/reviews";
import { SEED_CATEGORIES, SEED_PRODUCTS } from "./seed-catalog";

// Capa: foto real do modelo exato quando existe (lib/photo-credits, licença
// livre com crédito); senão a placa técnica em SVG (`npm run art`).
function categoryImage(slug: string) {
  return `/images/categories/${slug}.svg`;
}

function productImage(slug: string) {
  return `/images/products/${slug}.svg`;
}

// `db` é o serviço do docker-compose: só existe na rede interna do Docker.
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "db"]);

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
      service_requests, notifications, saga_steps, sagas, outbox,
      wishlist_items, reviews, payments, order_items, orders,
      cart_items, carts, coupons, product_variants, product_images,
      products, categories, addresses, users
    RESTART IDENTITY CASCADE
  `);

  console.log("📁 Criando categorias...");
  const insertedCategories = await db
    .insert(categories)
    .values(
      SEED_CATEGORIES.map((c) => ({
        name: c.name,
        slug: c.slug,
        description: c.description,
        imageUrl: categoryImage(c.slug),
      })),
    )
    .returning();
  const categoryIdByKey = new Map(SEED_CATEGORIES.map((c, i) => [c.key, insertedCategories[i].id]));

  console.log("📦 Criando produtos...");
  for (const p of SEED_PRODUCTS) {
    const categoryId = categoryIdByKey.get(p.category);
    if (!categoryId) throw new Error(`Categoria desconhecida no catálogo: ${p.category}`);
    // Produto com variante: o estoque que vale é o de cada variante; o do
    // produto é a soma, pra listagem e busca mostrarem disponibilidade certa.
    const stockQuantity = p.variants?.length
      ? p.variants.reduce((total, v) => total + v.stockQuantity, 0)
      : p.stockQuantity;

    const photo = PRODUCT_PHOTOS[p.slug];
    const [inserted] = await db
      .insert(products)
      .values({
        categoryId,
        name: p.name,
        slug: p.slug,
        description: p.description,
        brand: p.brand,
        sku: p.sku,
        priceCents: p.priceCents,
        compareAtPriceCents: p.compareAtPriceCents,
        stockQuantity,
        // Vitrine: os itens com foto real do modelo exato.
        isFeatured: Boolean(PRODUCT_PHOTOS[p.slug]),
        specs: p.specs,
      })
      .returning();

    // Foto real (Commons, licença livre) quando existe a do modelo exato; a
    // placa técnica fica como segunda vista. Sem foto, a placa é a capa.
    await db.insert(productImages).values(
      photo
        ? [
            { productId: inserted.id, url: photo.file, altText: `${p.name} — foto`, position: 0 },
            { productId: inserted.id, url: productImage(p.slug), altText: `${p.name} — ficha técnica`, position: 1 },
          ]
        : [{ productId: inserted.id, url: productImage(p.slug), altText: p.name, position: 0 }],
    );

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
      name: "Comando Dystopia",
      role: "admin",
    })
    .returning();

  const [customer] = await db
    .insert(users)
    .values({
      email: "cliente@dystopia.dev",
      passwordHash: customerPasswordHash,
      name: "Cidadão Registrado",
      role: "customer",
    })
    .returning();

  await db.insert(addresses).values({
    userId: customer.id,
    label: "Casa",
    recipientName: "Cidadão Registrado",
    street: "Rua do Setor 04",
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
    description: "Diretiva 10: 10% sobre a primeira aquisição",
    discountType: "percentage",
    discountValue: 10,
    minOrderCents: 5000,
    maxUsage: 500,
    validFrom: new Date(),
  });

  console.log("⭐ Criando reviews de exemplo...");
  const allProducts = await db.select().from(products).where(sql`${products.isFeatured}`).limit(5);
  for (const prod of allProducts) {
    await db.insert(reviews).values({
      productId: prod.id,
      userId: customer.id,
      rating: 5,
      title: "Conforme especificado.",
      comment: "Entregue no prazo. Instalado sem incidentes. Desempenho dentro do registrado.",
      isVerifiedPurchase: true,
    });
    // Insert direto não passa pelo serviço: a média do produto precisa ser recalculada.
    await recalculateProductRating(db, prod.id);
  }

  console.log("✅ Seed concluído!");
  console.log(`   ${SEED_PRODUCTS.length} produtos em ${SEED_CATEGORIES.length} categorias`);
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
