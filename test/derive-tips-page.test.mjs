import assert from "node:assert/strict";
import test from "node:test";
import { deriveTipsPage } from "../scripts/derive-tips-page.mjs";

const ENDPOINTS = {
  endpoints: [
    { id: "live-one", provider: "Hive (HBD transfer with memo)", rail: "hive", walletId: "hive:emsenn0", state: "live", handsItem: null },
    { id: "ready-one", provider: "Stripe Checkout", rail: "card", walletId: null, state: "code-ready", handsItem: "arm live credentials" },
    { id: "pending-one", provider: "Cash App", rail: "platform", walletId: null, state: "needs-account", handsItem: "create a Cash App account" },
    { id: "pending-wallet-one", provider: "Base (USDC transfer)", rail: "base-usdc", walletId: null, state: "needs-wallet", handsItem: "name a Base wallet for this endpoint" },
  ],
};

const REGISTRY = { wallets: [{ chain: "hive", address: "emsenn0" }] };

test("lists only live and code-ready endpoints on the page, resolving a wallet-backed one", async () => {
  const { markdown, refusals, endpoints } = await deriveTipsPage(ENDPOINTS, {
    loadRegistry: () => REGISTRY,
    verifyCustody: async () => ({ rows: [{ chain: "hive", address: "emsenn0", custodyKind: "env-on-host", status: "agreed" }] }),
  });
  assert.match(markdown, /Hive \(HBD transfer with memo\)/u);
  assert.match(markdown, /@emsenn0/u);
  assert.match(markdown, /Stripe Checkout/u);
  assert.doesNotMatch(markdown, /Cash App/u);
  assert.deepEqual(refusals, []);
  assert.equal(endpoints.find((endpoint) => endpoint.id === "live-one").receiver, "emsenn0");
  assert.equal(endpoints.find((endpoint) => endpoint.id === "ready-one").receiver, null);
});

test("omits a wallet-backed endpoint whose custody never verified as agreed, and reports the refusal", async () => {
  const { markdown, refusals } = await deriveTipsPage(ENDPOINTS, {
    loadRegistry: () => REGISTRY,
    verifyCustody: async () => ({ rows: [{ chain: "hive", address: "emsenn0", custodyKind: "unknown", status: "missing" }] }),
  });
  assert.doesNotMatch(markdown, /Hive \(HBD transfer with memo\)/u);
  assert.match(markdown, /Stripe Checkout/u);
  assert.equal(refusals.length, 1);
  assert.equal(refusals[0].refused, "RECEIVER_NOT_IN_CUSTODY");
  assert.equal(refusals[0].walletId, "hive:emsenn0");
});

test("returns needs-account and needs-wallet endpoints as handsItems, never on the page", async () => {
  const { handsItems, markdown } = await deriveTipsPage(ENDPOINTS, {
    loadRegistry: () => REGISTRY,
    verifyCustody: async () => ({ rows: [{ chain: "hive", address: "emsenn0", custodyKind: "env-on-host", status: "agreed" }] }),
  });
  assert.equal(handsItems.length, 2);
  assert.deepEqual(handsItems.map((item) => item.id).sort(), ["pending-one", "pending-wallet-one"]);
  assert.doesNotMatch(markdown, /Cash App/u);
});

test("never calls the registry or custody wiring when no listed endpoint carries a walletId", async () => {
  const endpoints = { endpoints: [{ id: "ready-one", provider: "Stripe Checkout", rail: "card", walletId: null, state: "code-ready", handsItem: null }] };
  let called = false;
  const { markdown } = await deriveTipsPage(endpoints, {
    loadRegistry: () => { called = true; return REGISTRY; },
    verifyCustody: async () => { called = true; return { rows: [] }; },
  });
  assert.equal(called, false);
  assert.match(markdown, /Stripe Checkout/u);
});
