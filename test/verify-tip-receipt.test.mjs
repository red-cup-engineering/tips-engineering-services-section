import assert from "node:assert/strict";
import test from "node:test";
import { verifyTipReceipt } from "../scripts/verify-tip-receipt.mjs";

const ENDPOINTS = {
  endpoints: [
    { id: "stripe-checkout-custom-amount", rail: "card", provider: "Stripe Checkout", walletId: null },
    { id: "hive-hbd-transfer", rail: "hive", provider: "Hive (HBD transfer with memo)", walletId: "hive:emsenn0" },
    { id: "base-usdc-transfer", rail: "base-usdc", provider: "Base (USDC transfer)", walletId: "base:0x224C08A8526751887a83e2711B167f890c6D078d" },
    { id: "lightning-zbd", rail: "lightning", provider: "Lightning Network via ZBD", walletId: null },
  ],
};

test("refuses an unknown endpoint id", async () => {
  const result = await verifyTipReceipt({ endpointId: "no-such-endpoint", claim: {} }, { endpoints: ENDPOINTS });
  assert.equal(result.verified, false);
  assert.equal(result.reason, "unknown-endpoint");
});

test("refuses a rail with no wired verification", async () => {
  const result = await verifyTipReceipt({ endpointId: "lightning-zbd", claim: {} }, { endpoints: ENDPOINTS });
  assert.equal(result.verified, false);
  assert.equal(result.reason, "verification-not-implemented-for-rail");
});

test("verifies a card claim against an injected Stripe webhook journal", async () => {
  const stripeJournal = { query: async () => [{ record: { stripeEventId: "evt_1", eventType: "checkout.session.completed", paymentStatus: "paid", amountTotal: 500, currency: "usd" } }] };
  const result = await verifyTipReceipt({ endpointId: "stripe-checkout-custom-amount", claim: { stripeEventId: "evt_1" } }, { endpoints: ENDPOINTS, stripeJournal, now: new Date("2026-09-05T00:00:00Z") });
  assert.equal(result.verified, true);
  assert.equal(result.receipt.amount, "5.00");
  assert.equal(result.receipt.currency, "USD");
});

test("refuses a card claim the journal never ingested", async () => {
  const stripeJournal = { query: async () => [] };
  const result = await verifyTipReceipt({ endpointId: "stripe-checkout-custom-amount", claim: { stripeEventId: "evt_missing" } }, { endpoints: ENDPOINTS, stripeJournal });
  assert.equal(result.verified, false);
  assert.equal(result.reason, "not-found");
});

const HIVE_ROW = { op: ["transfer", { to: "emsenn0", from: "a-tipper", memo: "thanks", amount: "5.000 HBD" }], block: 1, trx_id: "abc123", timestamp: "2026-09-05T09:00:00" };

test("verifies a hive claim when both fixture nodes agree", async () => {
  const result = await verifyTipReceipt(
    { endpointId: "hive-hbd-transfer", claim: { amount: "5.000", asset: "HBD", memo: "thanks", observedAt: "2026-09-05T10:00:00Z", block: 1, transactionId: "abc123", fixtureResponses: [[HIVE_ROW], [HIVE_ROW]] } },
    { endpoints: ENDPOINTS },
  );
  assert.equal(result.verified, true);
  assert.equal(result.receipt.rail, "hive");
  assert.equal(result.receipt.amount, "5.000");
  assert.equal(result.receipt.currency, "HBD");
});

test("refuses a hive claim the two fixture nodes disagree on", async () => {
  const result = await verifyTipReceipt(
    { endpointId: "hive-hbd-transfer", claim: { amount: "5.000", asset: "HBD", memo: "thanks", observedAt: "2026-09-05T10:00:00Z", block: 1, transactionId: "abc123", fixtureResponses: [[HIVE_ROW], []] } },
    { endpoints: ENDPOINTS },
  );
  assert.equal(result.verified, false);
  assert.equal(result.reason, "nodes-disagree");
});

function fakeUsdcTransferFetch(rawValueHex, status = "0x1") {
  return async () => ({
    ok: true,
    json: async () => ({
      jsonrpc: "2.0",
      id: 1,
      result: {
        status,
        logs: [{
          address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          topics: ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", "0x0000000000000000000000000000000000000000000000000000000000000001", "0x000000000000000000000000224c08a8526751887a83e2711b167f890c6d078d"],
          data: rawValueHex,
        }],
      },
    }),
  });
}

test("verifies a base-usdc claim when two fixture RPC endpoints agree", async () => {
  const result = await verifyTipReceipt(
    { endpointId: "base-usdc-transfer", claim: { amount: "5", txHash: "0xdeadbeef" } },
    { endpoints: ENDPOINTS, fetchImpl: fakeUsdcTransferFetch("0x4c4b40") },
  );
  assert.equal(result.verified, true);
  assert.equal(result.receipt.currency, "USDC");
});

test("refuses a base-usdc claim whose amount does not match the on-chain transfer", async () => {
  const result = await verifyTipReceipt(
    { endpointId: "base-usdc-transfer", claim: { amount: "9", txHash: "0xdeadbeef" } },
    { endpoints: ENDPOINTS, fetchImpl: fakeUsdcTransferFetch("0x4c4b40") },
  );
  assert.equal(result.verified, false);
  assert.equal(result.reason, "wrong-amount");
});

test("refuses a hive claim against an endpoint with no walletId", async () => {
  const endpoints = { endpoints: [{ id: "hive-no-wallet", rail: "hive", provider: "Hive", walletId: null }] };
  const result = await verifyTipReceipt({ endpointId: "hive-no-wallet", claim: { amount: "5.000", asset: "HBD", memo: "thanks", observedAt: "2026-09-05T10:00:00Z" } }, { endpoints });
  assert.equal(result.verified, false);
  assert.equal(result.reason, "endpoint-has-no-wallet");
});

test("throws on a malformed request rather than refusing as data", async () => {
  await assert.rejects(() => verifyTipReceipt({ endpointId: "", claim: {} }), TypeError);
});
