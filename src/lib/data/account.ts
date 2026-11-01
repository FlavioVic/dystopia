import { cache } from "react";
import { db } from "@/db";
import { listAddresses } from "@/services/addresses";
import { getMfaStatus } from "@/services/mfa";
import { getUserReview, ratingBreakdown } from "@/services/reviews";
import { countActiveSessions } from "@/services/sessions";

/**
 * Leituras da conta para as páginas — quem é a pessoa a página já sabe (da
 * sessão) e passa o id. A tela não fala com banco nem serviço direto: passa
 * por aqui (o teste de arquitetura cobra).
 */

export const getAddresses = cache(async (userId: string) => listAddresses(db, userId));

export const getActiveSessionCount = cache(async (userId: string) => countActiveSessions(db, userId));

export const getMfaStatusOf = cache(async (userId: string) => getMfaStatus(db, userId));

/** A avaliação que a pessoa já deixou neste produto (o formulário vem preenchido). */
export const getOwnReview = cache(async (userId: string, productId: string) => getUserReview(db, userId, productId));

/** Distribuição das notas do produto (quantas de cada estrela). */
export const getRatingBreakdown = cache(async (productId: string) => ratingBreakdown(db, productId));
