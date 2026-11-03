/**
 * Senha vazada (Pwned Passwords, k-anonimato): o que sai daqui, o que volta
 * e o que acontece quando a API não responde.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { BREACHED_PASSWORD_MESSAGE, breachedPasswordMessage } from "@/application/password-policy";
import { isBreachedPassword, type FetchLike } from "@/services/accounts/pwned-passwords";

const PASSWORD = "senha-de-teste-123";
const HASH = createHash("sha1").update(PASSWORD).digest("hex").toUpperCase();

/** API falsa: devolve `lines` e guarda o que foi pedido. */
function fakeApi(lines: string[], status = 200) {
  const calls: { url: string; headers: Headers }[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, headers: new Headers(init?.headers) });
    return new Response(lines.join("\r\n"), { status });
  };
  return { fetchImpl, calls };
}

describe("senha vazada (Pwned Passwords)", () => {
  it("só os 5 primeiros caracteres do SHA-1 saem daqui, com padding pedido", async () => {
    const api = fakeApi([`${HASH.slice(5)}:3`]);
    await isBreachedPassword(PASSWORD, api.fetchImpl);

    assert.equal(api.calls.length, 1);
    assert.equal(api.calls[0].url, `https://api.pwnedpasswords.com/range/${HASH.slice(0, 5)}`);
    assert.ok(!api.calls[0].url.includes(HASH.slice(5)), "o resto do hash não sai");
    assert.ok(!api.calls[0].url.includes(PASSWORD));
    assert.equal(api.calls[0].headers.get("add-padding"), "true");
  });

  it("sufixo na lista com contagem = vazou", async () => {
    const api = fakeApi(["0000000000000000000000000000000000A:1", `${HASH.slice(5)}:42`]);
    assert.equal(await isBreachedPassword(PASSWORD, api.fetchImpl), true);
  });

  it("sufixo fora da lista = não vazou", async () => {
    const api = fakeApi(["0000000000000000000000000000000000A:7"]);
    assert.equal(await isBreachedPassword(PASSWORD, api.fetchImpl), false);
  });

  it("linha de padding (contagem 0) não conta como vazamento", async () => {
    const api = fakeApi([`${HASH.slice(5)}:0`]);
    assert.equal(await isBreachedPassword(PASSWORD, api.fetchImpl), false);
  });

  it("API fora do ar ou com erro: não dá para saber, e a senha passa", async () => {
    assert.equal(await isBreachedPassword(PASSWORD, fakeApi([], 503).fetchImpl), null);
    const offline: FetchLike = async () => {
      throw new TypeError("fetch failed");
    };
    assert.equal(await isBreachedPassword(PASSWORD, offline), null);
    assert.equal(await breachedPasswordMessage(PASSWORD, async () => null), null);
  });

  it("a regra de senha nova recusa só o que vazou", async () => {
    assert.equal(await breachedPasswordMessage(PASSWORD, async () => true), BREACHED_PASSWORD_MESSAGE);
    assert.equal(await breachedPasswordMessage(PASSWORD, async () => false), null);
  });
});
