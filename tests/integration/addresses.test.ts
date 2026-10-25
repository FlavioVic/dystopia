/**
 * Agenda de endereços: padrão único, exclusão protegida por pedido e escopo
 * por usuário.
 */

import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import { db } from "@/db";
import { PermanentError } from "@/saga/errors";
import {
  addressUsageCount,
  createAddress,
  deleteAddress,
  getUserAddress,
  listAddresses,
  setDefaultAddress,
} from "@/services/addresses";
import { closeDatabase, resetDatabase, seedCheckoutFixture } from "../helpers/db";
import { startCheckout } from "../helpers/checkout";

beforeEach(resetDatabase);
after(closeDatabase);

const base = {
  label: "Casa",
  recipientName: "Cliente Teste",
  street: "Rua das Flores",
  number: "123",
  complement: null,
  neighborhood: "Centro",
  city: "São Paulo",
  state: "SP",
  zipCode: "01000-000",
};

describe("agenda de endereços", () => {
  it("o primeiro endereço vira padrão sozinho", async () => {
    const fixture = await seedCheckoutFixture();
    const primeiro = await createAddress(db, fixture.userId, base);
    assert.equal(primeiro.isDefault, true);

    const segundo = await createAddress(db, fixture.userId, { ...base, label: "Trabalho" });
    assert.equal(segundo.isDefault, false, "os seguintes não roubam o padrão");
  });

  it("só existe um padrão por vez", async () => {
    const fixture = await seedCheckoutFixture();
    const casa = await createAddress(db, fixture.userId, base);
    const trabalho = await createAddress(db, fixture.userId, { ...base, label: "Trabalho" });

    assert.deepEqual(await setDefaultAddress(db, fixture.userId, trabalho.id), { changed: true });

    const list = await listAddresses(db, fixture.userId);
    assert.equal(list.filter((address) => address.isDefault).length, 1);
    assert.equal(list[0].id, trabalho.id, "padrão vem primeiro na lista");
    assert.equal((await getUserAddress(db, fixture.userId, casa.id))?.isDefault, false);
  });

  it("marcar como padrão de novo não é erro", async () => {
    const fixture = await seedCheckoutFixture();
    const casa = await createAddress(db, fixture.userId, base);
    assert.deepEqual(await setDefaultAddress(db, fixture.userId, casa.id), { changed: false });
  });

  it("não deixa marcar endereço de outra pessoa", async () => {
    const dono = await seedCheckoutFixture();
    const intruso = await seedCheckoutFixture();
    const doDono = await createAddress(db, dono.userId, base);

    await assert.rejects(
      () => setDefaultAddress(db, intruso.userId, doDono.id),
      (error: unknown) => error instanceof PermanentError && error.code === "address_not_found",
    );
    assert.equal(await getUserAddress(db, intruso.userId, doDono.id), undefined);
  });

  it("cada pessoa vê só os próprios endereços", async () => {
    const ana = await seedCheckoutFixture();
    const bruno = await seedCheckoutFixture();
    await createAddress(db, ana.userId, base);
    await createAddress(db, bruno.userId, { ...base, label: "Do Bruno" });

    assert.equal((await listAddresses(db, ana.userId)).length, 1);
    assert.equal((await listAddresses(db, bruno.userId))[0].label, "Do Bruno");
  });

  it("remover promove outro endereço a padrão", async () => {
    const fixture = await seedCheckoutFixture();
    const casa = await createAddress(db, fixture.userId, base);
    await createAddress(db, fixture.userId, { ...base, label: "Trabalho" });

    assert.deepEqual(await deleteAddress(db, fixture.userId, casa.id), { deleted: true });

    const list = await listAddresses(db, fixture.userId);
    assert.equal(list.length, 1);
    assert.equal(list[0].isDefault, true, "a conta não fica sem padrão");
  });

  it("não remove endereço preso em pedido (FK é RESTRICT de propósito)", async () => {
    const fixture = await seedCheckoutFixture({ stock: 5, quantity: 1 });
    const checkout = await startCheckout(fixture);

    const [address] = await listAddresses(db, fixture.userId);
    assert.equal(await addressUsageCount(db, address.id), 1, "entrega e cobrança apontam para o mesmo");

    await assert.rejects(
      () => deleteAddress(db, fixture.userId, address.id),
      (error: unknown) => error instanceof PermanentError && error.code === "address_in_use",
    );

    assert.equal((await listAddresses(db, fixture.userId)).length, 1, "continua lá");
    assert.ok(checkout.orderId);
  });

  it("remover endereço inexistente não é erro", async () => {
    const fixture = await seedCheckoutFixture();
    assert.deepEqual(
      await deleteAddress(db, fixture.userId, "00000000-0000-0000-0000-000000000000"),
      { deleted: false },
    );
  });
});
