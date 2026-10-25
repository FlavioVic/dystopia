import assert from "node:assert/strict";
import type { FormResult } from "@/lib/validation/form";

/** Valores de um formulário que TEM que ser válido (falha mostrando os erros). */
export function valuesOf<T>(result: FormResult<T>): T {
  assert.ok(result.ok, `formulário deveria ser válido: ${JSON.stringify(result.errors)}`);
  return result.values;
}
