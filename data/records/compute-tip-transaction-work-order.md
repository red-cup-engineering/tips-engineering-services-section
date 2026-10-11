# compute-tip-transaction
## Requirements
- `balanced-tip-transaction`: The operation must derive one balanced Beancount transaction directive (and any `open` directives for accounts not already open) from one verified tip receipt, debiting the rail's asset account (and an `Expenses:Fees:<Provider>` account when the receipt carries a fee) and crediting `Income:Tips:<Provider>` for the gross amount, in the receipt's currency, using exact-decimal string arithmetic never floating point.
## Prohibitions
- `refuses-non-positive-amount`: The operation must throw rather than derive a transaction when the receipt's amount is not a positive decimal string.
- `refuses-fee-exceeding-amount`: The operation must throw rather than derive an unbalanced transaction when a receipt's fee amount is greater than or equal to its gross amount.
## Laws
- `exact-decimal-arithmetic-law` | computer-ledger-system-services-section decimal.mjs (`@red-cup-engineering/computer-ledger-system-services-section@0.4.2`) | 2026-09-05 | lib/emsenn/services/561-group/services/engineering-services-section/services/computer-engineering-services-section/services/computer-systems-engineering-services-section/services/computer-ledger-system-services-section/src/decimal.mjs | Applies to every amount computed or compared by this operation. | `addDecimalStrings`/`parseDecimal`/`formatScaled` are BigInt-scaled decimal-string arithmetic; a balance or price is never a JavaScript `Number`.
- `pure-data-transformation-law` | The language law (asserted 2026-08-30) | v1 | .claude/rules/org-layering.md | Applies to computeTipTransaction as receipt-to-directive transformation, never filesystem or network I/O. | A function computing a ledger directive from a receipt performs no I/O of its own; effects (writing the sidecar file, recording a receipt) are a caller's concern.
## Standards
- `node-esm-operation` | Node.js | v24.2.0+ | https://nodejs.org/docs/v24/api/esm.html | Applies to the .mjs operation and its import.meta.main guard. | The package uses one executable ESM operation source file eligible for downstream staged package-birth assays.
## Open questions
none
## Package
```json
{"packageName":"@red-cup-engineering/scratch-compute-tip-transaction-20260905-service","packageVersion":"0.1.0","license":"UNLICENSED","dependencies":{"@red-cup-engineering/computer-ledger-system-services-section":"0.4.2"},"devDependencies":{}}
```
## Operation
```mjs path=scripts/scratch-compute-tip-transaction-20260905.mjs
#!/usr/bin/env node
import { addDecimalStrings, compareDecimalStrings, negateDecimalString, parseDecimal } from "@red-cup-engineering/computer-ledger-system-services-section/src/decimal.mjs";

const RAIL_ASSET_ACCOUNTS = {
  card: "Assets:Cash:Operating",
  bank: "Assets:Cash:Operating",
  "base-usdc": "Assets:Digital-Assets:EVM:Base:Tokens",
  platform: "Assets:Cash:Operating",
  lightning: "Assets:Digital-Assets:Lightning:Custody",
};

function toAccountComponent(text) {
  return String(text).trim().split(/[\s-]+/u).filter(Boolean).map((w) => (/^\d/u.test(w) ? w : `${w.charAt(0).toUpperCase()}${w.slice(1)}`)).join("-");
}

function railAssetAccount(rail, receiver) {
  if (rail === "hive") return `Assets:Digital-Assets:Hive:Custody:${toAccountComponent(receiver)}`;
  const account = RAIL_ASSET_ACCOUNTS[rail];
  if (!account) throw new TypeError(`compute-tip-transaction: unrecognized rail "${rail}"`);
  return account;
}

function renderDirective({ date, narration, metadata, postings }) {
  const lines = [`${date} * "${narration}"`];
  for (const [key, value] of Object.entries(metadata)) lines.push(`  ${key}: "${value}"`);
  for (const { account, amount, currency } of postings) lines.push(`  ${account}  ${amount} ${currency}`);
  return lines.join("\n");
}

/**
 * Derives one balanced Beancount transaction directive (plus `open` directives for accounts not
 * already open) from one verified tip receipt: debits the rail's asset account for the net
 * amount received, debits `Expenses:Fees:<Provider>` for a stated fee, and credits
 * `Income:Tips:<Provider>` for the gross amount, all in exact-decimal string arithmetic.
 * @param {{receipt: {rail: string, provider: string, receiver: string, amount: string, currency: string, feeAmount?: string, receiptId: string, verifiedAt: string}, openAccounts?: string[]}} input
 * @returns {{type: "TipTransaction", date: string, narration: string, postings: object[], accountsToOpen: object[], directive: string}}
 * @throws {TypeError} When `input.receipt.amount` is not a positive decimal string or `feeAmount` is present but not less than `amount`.
 */
export function computeTipTransaction({ receipt, openAccounts = [] }) {
  const { rail, provider, receiver, amount, currency, feeAmount, receiptId, verifiedAt } = receipt;
  if (compareDecimalStrings(amount, "0") <= 0) throw new TypeError(`compute-tip-transaction: amount must be a positive decimal string, got "${amount}"`);
  if (feeAmount !== undefined && feeAmount !== null && compareDecimalStrings(feeAmount, amount) >= 0) {
    throw new TypeError(`compute-tip-transaction: feeAmount "${feeAmount}" must be less than amount "${amount}"`);
  }
  const providerComponent = toAccountComponent(provider);
  const assetAccount = railAssetAccount(rail, receiver);
  const incomeAccount = `Income:Tips:${providerComponent}`;
  const feeAccount = `Expenses:Fees:${providerComponent}`;
  const netAmount = feeAmount ? addDecimalStrings([amount, negateDecimalString(feeAmount)]) : amount;
  const date = verifiedAt.slice(0, 10);
  const postings = [{ account: assetAccount, amount: netAmount, currency }];
  if (feeAmount) postings.push({ account: feeAccount, amount: feeAmount, currency });
  postings.push({ account: incomeAccount, amount: negateDecimalString(amount), currency });
  const opened = new Set(openAccounts);
  const accountsToOpen = [...new Set(postings.map((p) => p.account))]
    .filter((account) => !opened.has(account))
    .sort()
    .map((account) => ({ account, date, directive: `${date} open ${account}` }));
  const metadata = { receipt_id: receiptId, rail, provider, receiver };
  const narration = `Tip via ${provider}`;
  return {
    type: "TipTransaction",
    date,
    narration,
    postings,
    accountsToOpen,
    directive: renderDirective({ date, narration, metadata, postings }),
  };
}

if (import.meta.main) {
  if (process.argv.includes("--help")) {
    process.stdout.write("computeTipTransaction — Derives one balanced Beancount transaction directive (plus `open` directives for accounts not already open) from one verified tip receipt: debits the rail's asset account for the net amount received, debits `Expenses:Fees:<Provider>` for a stated fee, and credits `Income:Tips:<Provider>` for the gross amount, all in exact-decimal string arithmetic.\n");
  } else {
    let text = "";
    for await (const chunk of process.stdin) text += chunk;
    for (const line of text.split("\n")) {
      if (line.trim().length > 0) process.stdout.write(`${JSON.stringify(computeTipTransaction(JSON.parse(line)))}\n`);
    }
  }
}
```
## Tests
```mjs path=test/compute-tip-transaction.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { computeTipTransaction } from "../scripts/scratch-compute-tip-transaction-20260905.mjs";

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
```
## Examples
```json name="a Hive HBD tip booked with no fee"
{"input":{"receipt":{"rail":"hive","provider":"hive","receiver":"emsenn0","amount":"5.000","currency":"HBD","receiptId":"tip-1","verifiedAt":"2026-09-05T12:00:00Z"}},"output":{"type":"TipTransaction","date":"2026-09-05","narration":"Tip via hive","postings":[{"account":"Assets:Digital-Assets:Hive:Custody:Emsenn0","amount":"5.000","currency":"HBD"},{"account":"Income:Tips:Hive","amount":"-5.000","currency":"HBD"}],"accountsToOpen":[{"account":"Assets:Digital-Assets:Hive:Custody:Emsenn0","date":"2026-09-05","directive":"2026-09-05 open Assets:Digital-Assets:Hive:Custody:Emsenn0"},{"account":"Income:Tips:Hive","date":"2026-09-05","directive":"2026-09-05 open Income:Tips:Hive"}],"directive":"2026-09-05 * \"Tip via hive\"\n  receipt_id: \"tip-1\"\n  rail: \"hive\"\n  provider: \"hive\"\n  receiver: \"emsenn0\"\n  Assets:Digital-Assets:Hive:Custody:Emsenn0  5.000 HBD\n  Income:Tips:Hive  -5.000 HBD"}}
```
## Traceability
- `balanced-tip-transaction` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `exact-decimal-arithmetic-law`
- `refuses-non-positive-amount` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `pure-data-transformation-law`
- `refuses-fee-exceeding-amount` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `pure-data-transformation-law`
