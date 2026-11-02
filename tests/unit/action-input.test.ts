import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isQuantity, isUuid } from "@/lib/validation/action-input";

describe("argumentos de Server Action", () => {
  it("id só passa no formato UUID (o resto viraria erro 500 no Postgres)", () => {
    assert.equal(isUuid("0cb4fb22-7b87-41a6-9365-6e724159eb6b"), true);
    assert.equal(isUuid("0CB4FB22-7B87-41A6-9365-6E724159EB6B"), true);
    for (const value of ["nao-e-uuid", "", "' OR 1=1 --", "0cb4fb22-7b87-41a6-9365-6e724159eb6b ", 123, null, undefined, {}]) {
      assert.equal(isUuid(value), false, String(value));
    }
  });

  it("quantidade só passa como número finito", () => {
    for (const value of [1, 0, -3, 2.5, 1e9]) assert.equal(isQuantity(value), true, String(value));
    for (const value of ["abc", "2", NaN, Infinity, null, undefined, [1]]) assert.equal(isQuantity(value), false, String(value));
  });
});
