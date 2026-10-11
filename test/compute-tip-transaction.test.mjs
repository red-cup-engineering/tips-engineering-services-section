import assert from "node:assert/strict";
import test from "node:test";
import { computeTipTransaction } from "../scripts/compute-tip-transaction.mjs";

const receipt = { rail: "hive", provider: "hive", receiver: "emsenn0", amount: "5.000", currency: "HBD", receiptId: "tip-1", verifiedAt: "2026-09-05T12:00:00Z" };

test("derives a balanced two-posting transaction with no fee", () => {
  const result = computeTipTransaction({ receipt });
  assert.equal(result.postings.length, 2);
  assert.equal(result.postings[0].account, "Assets:Digital-Assets:Hive:Custody:Emsenn0");
  assert.equal(result.postings[1].account, "Income:Tips:Hive");
  assert.equal(result.postings[1].amount, "-5.000");
});

test("derives a balanced three-posting transaction with a fee", () => {
  const withFee = { ...receipt, rail: "card", provider: "stripe", feeAmount: "0.59", amount: "5.00", currency: "USD" };
  const result = computeTipTransaction({ receipt: withFee });
  assert.equal(result.postings.length, 3);
  assert.equal(result.postings[0].amount, "4.41");
  assert.equal(result.postings[1].account, "Expenses:Fees:Stripe");
});

test("refuses a non-positive amount", () => {
  assert.throws(() => computeTipTransaction({ receipt: { ...receipt, amount: "0" } }), TypeError);
});

test("refuses a fee that meets or exceeds the amount", () => {
  assert.throws(() => computeTipTransaction({ receipt: { ...receipt, feeAmount: "5.000" } }), TypeError);
});
