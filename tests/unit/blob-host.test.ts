/** Host do Vercel Blob liberado no otimizador de imagem: só o store da loja. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { blobPublicHostname } from "@/lib/blob-host";

describe("host do Vercel Blob (otimizador de imagem)", () => {
  it("sai do BLOB_STORE_ID, em minúsculas, como o endereço público do store", () => {
    assert.equal(
      blobPublicHostname({ BLOB_STORE_ID: "store_Aui98kVMTHsCrERc" }),
      "aui98kvmthscrerc.public.blob.vercel-storage.com",
    );
  });

  it("sem o id, sai do token de escrita (o segredo não entra no host)", () => {
    const host = blobPublicHostname({ BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_Aui98kVMTHsCrERc_SegredoQueNaoVaza123" });
    assert.equal(host, "aui98kvmthscrerc.public.blob.vercel-storage.com");
    assert.ok(!host!.includes("segredo"));
  });

  it("sem store configurado (ou com valor estranho), nenhum host remoto", () => {
    assert.equal(blobPublicHostname({}), null);
    assert.equal(blobPublicHostname({ BLOB_STORE_ID: "store_" }), null);
    assert.equal(blobPublicHostname({ BLOB_STORE_ID: "store_*.evil" }), null, "nunca vira curinga");
    assert.equal(blobPublicHostname({ BLOB_READ_WRITE_TOKEN: "lixo" }), null);
  });
});
