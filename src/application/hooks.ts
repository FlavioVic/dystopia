/**
 * O que um caso de uso avisa para quem o chamou, sem saber quem é.
 *
 * Caso de uso que grava mensagem na caixa de saída chama `afterCommit`
 * depois do commit. Quem liga isso é a raiz de composição da borda web
 * (`src/composition/web.ts`): com worker de pé, nada; no deploy só-Vercel,
 * um dreno da fila depois da resposta. O caso de uso não conhece nenhum dos dois.
 */
export type UseCaseHooks = {
  afterCommit?: () => void;
};
