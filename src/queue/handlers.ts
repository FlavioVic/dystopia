/**
 * Registro de handlers da fila: tipo de mensagem → função que processa.
 *
 * Só os handlers da saga moram aqui. Os dos serviços (pagamentos, e-mail)
 * entram por injeção na raiz de composição (`src/composition/worker.ts`) — a
 * fila não importa serviço nenhum.
 */

import { handleSagaAdvance, handleSagaReply } from "@/saga/runner";
import { SAGA_ADVANCE, SAGA_REPLY } from "@/saga/messaging";
import type { MessageHandler } from "./index";

export const sagaHandlers: Record<string, MessageHandler> = {
  [SAGA_ADVANCE]: handleSagaAdvance,
  [SAGA_REPLY]: handleSagaReply,
};
