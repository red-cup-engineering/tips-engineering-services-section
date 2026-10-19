#!/usr/bin/env node
import { addDecimalStrings, compareDecimalStrings, negateDecimalString } from "@red-cup-engineering/computer-data-engineering-services-section/number/decimal-string";
import { toAccountComponent } from "../src/tips.mjs";
import { runJavascriptNodeOperation } from "@red-cup-engineering/javascript-node-operation-engineering-services-section/operation";

const RAIL_ASSET_ACCOUNTS = {
  card: "Assets:Cash:Operating",
  bank: "Assets:Cash:Operating",
  "base-usdc": "Assets:Digital-Assets:EVM:Base:Tokens",
  platform: "Assets:Cash:Operating",
  lightning: "Assets:Digital-Assets:Lightning:Custody",
};

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
  const result = await runJavascriptNodeOperation({ name: "compute-tip-transaction", description: "Derives one balanced Beancount transaction directive (plus `open` directives for accounts not already open) from one verified tip receipt: debits the rail's asset account for the net amount received, debits `Expenses:Fees:<Provider>` for a stated fee, and credits `Income:Tips:<Provider>` for the gross amount, all in exact-decimal string arithmetic.", operation: computeTipTransaction }, { arguments: process.argv.slice(2), standardInput: process.stdin, standardOutput: process.stdout });
  process.exitCode = result.exitCode;
}
