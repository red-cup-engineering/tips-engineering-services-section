import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

function cli(script, input, args = []) {
  return spawnSync(process.execPath, [fileURLToPath(new URL(`../scripts/${script}.mjs`, import.meta.url)), ...args], {
    input, encoding: "utf8", env: {}, timeout: 10000,
  });
}

test("compute CLI receives NDJSON through the published operation runtime", () => {
  const receipt = { rail: "card", provider: "fixture", receiver: "fixture", amount: "5.00", feeAmount: "0.59", currency: "USD", receiptId: "fixture-cli", verifiedAt: "2026-09-05T12:00:00Z" };
  const result = cli("compute-tip-transaction", JSON.stringify({ receipt }) + "\n");
  assert.equal(result.status, 0, result.stderr);
  const record = JSON.parse(result.stdout);
  assert.equal(record.type, "TipTransaction");
  assert.equal(record.postings[0].amount, "4.41");
  assert.equal(record.postings[2].amount, "-5.00");
});

test("compute CLI preserves structured refusal and nonzero disposition", () => {
  const result = cli("compute-tip-transaction", "{\n");
  assert.equal(result.status, 2, result.stderr);
  assert.equal(JSON.parse(result.stdout).ok, false);
});

test("verify CLI help loads the operation supplier without invoking verification", () => {
  const result = cli("verify-tip-receipt", "", ["--help"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /verify-tip-receipt/);
});
