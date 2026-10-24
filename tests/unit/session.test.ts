/**
 * Sessão: o JWT é a única coisa que diz quem a pessoa é e se é admin. Aqui
 * fica provado que ninguém fabrica nem altera um.
 */

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { SignJWT, UnsecuredJWT } from "jose";

// O módulo lê o segredo ao carregar; import dinâmico (tsx compila pra CJS,
// sem await no topo) depois de garantir que ele existe.
process.env.SESSION_SECRET ??= "segredo-de-teste-da-sessao-com-tamanho";
let signSessionToken: typeof import("@/lib/session").signSessionToken;
let verifySessionToken: typeof import("@/lib/session").verifySessionToken;
before(async () => {
  ({ signSessionToken, verifySessionToken } = await import("@/lib/session"));
});

const key = (secret: string) => new TextEncoder().encode(secret);

describe("sessão (JWT)", () => {
  it("o token assinado volta com o mesmo usuário e papel", async () => {
    const token = await signSessionToken({ userId: "u-1", role: "admin" });
    assert.deepEqual(await verifySessionToken(token), { userId: "u-1", role: "admin" });
  });

  it("token adulterado (virar admin trocando o payload) é recusado", async () => {
    const token = await signSessionToken({ userId: "u-1", role: "customer" });
    const [header, , signature] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ userId: "u-1", role: "admin" })).toString("base64url");
    assert.equal(await verifySessionToken(`${header}.${forged}.${signature}`), null);
  });

  it("assinado com outro segredo é recusado", async () => {
    const token = await new SignJWT({ userId: "u-1", role: "admin" })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("1h")
      .sign(key("outro-segredo-qualquer-de-atacante"));
    assert.equal(await verifySessionToken(token), null);
  });

  it("token sem assinatura (alg: none) é recusado", async () => {
    const token = new UnsecuredJWT({ userId: "u-1", role: "admin" }).setExpirationTime("1h").encode();
    assert.equal(await verifySessionToken(token), null);
  });

  it("expirado é recusado", async () => {
    const token = await new SignJWT({ userId: "u-1", role: "customer" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(key(process.env.SESSION_SECRET!));
    assert.equal(await verifySessionToken(token), null);
  });

  it("papel desconhecido ou payload incompleto é recusado", async () => {
    for (const payload of [{ userId: "u-1", role: "superadmin" }, { role: "admin" }, { userId: 42, role: "admin" }]) {
      const token = await new SignJWT(payload)
        .setProtectedHeader({ alg: "HS256" })
        .setExpirationTime("1h")
        .sign(key(process.env.SESSION_SECRET!));
      assert.equal(await verifySessionToken(token), null, JSON.stringify(payload));
    }
  });

  it("sem token ou lixo: sem sessão, sem exceção", async () => {
    assert.equal(await verifySessionToken(undefined), null);
    assert.equal(await verifySessionToken("nao.e.jwt"), null);
  });
});
