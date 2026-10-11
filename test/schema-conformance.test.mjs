import assert from "node:assert/strict";
import test from "node:test";
import { validateJson } from "@red-cup-engineering/json-schema-services-section/validation";
import tipEndpointSchema from "../data/records/schema/tip-endpoint.schema.json" with { type: "json" };
import { loadEndpoints } from "../src/tips.mjs";

// json-schema-services-section does not yet recognize the "uri"/"date" string formats feeSchedule uses
// (friction admitted 2026-09-05 against @red-cup-engineering/json-schema-services-section, unrelated to
// this schema's walletId/receiver shape); every endpoint is validated with feeSchedule normalized
// to "unknown" so this test exercises the shape this lot actually changed.
function withoutFeeScheduleFormats(endpoint) {
  return { ...endpoint, feeSchedule: "unknown" };
}

test("tip-endpoint schema: every bundled endpoint validates, and carries walletId not receiver", () => {
  const endpoints = loadEndpoints();
  for (const endpoint of endpoints.endpoints) {
    const result = validateJson({ value: withoutFeeScheduleFormats(endpoint), schema: tipEndpointSchema });
    assert.equal(result.valid, true, `${endpoint.id}: ${JSON.stringify(result.errors)}`);
    assert.equal(endpoint.receiver, undefined, `${endpoint.id} must not carry a literal receiver`);
    assert.ok("walletId" in endpoint, `${endpoint.id} must carry a walletId key`);
  }
});

test("tip-endpoint schema: a walletId must be chain-qualified or null", () => {
  const base = { id: "x", rail: "hive", provider: "Hive", state: "live", verificationOperation: null, bookingAccount: "Income:Tips:Hive", feeSchedule: "unknown", handsItem: null };
  assert.equal(validateJson({ value: { ...base, walletId: "hive:emsenn0" }, schema: tipEndpointSchema }).valid, true);
  assert.equal(validateJson({ value: { ...base, walletId: null }, schema: tipEndpointSchema }).valid, true);
  assert.equal(validateJson({ value: { ...base, walletId: "emsenn0" }, schema: tipEndpointSchema }).valid, false);
});

test("tip-endpoint schema: state accepts needs-wallet", () => {
  const base = { id: "x", rail: "base-usdc", provider: "Base", walletId: null, verificationOperation: null, bookingAccount: "Income:Tips:Base-USDC", feeSchedule: "unknown", handsItem: "name a wallet" };
  assert.equal(validateJson({ value: { ...base, state: "needs-wallet" }, schema: tipEndpointSchema }).valid, true);
});

test("tip-endpoint schema: receiver is rejected as an unknown property", () => {
  const base = { id: "x", rail: "hive", provider: "Hive", walletId: "hive:emsenn0", state: "live", verificationOperation: null, bookingAccount: "Income:Tips:Hive", feeSchedule: "unknown", handsItem: null };
  assert.equal(validateJson({ value: { ...base, receiver: "emsenn0" }, schema: tipEndpointSchema }).valid, false);
});
