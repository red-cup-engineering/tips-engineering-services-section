#!/usr/bin/env node
/**
 * Verifies one buyer-claimed tip against the rail its endpoint moves value over: an already-
 * ingested Stripe `checkout.session.completed` event for `card`, a two-Hive-node-agreeing
 * transfer via `verify-hbd-payment-service` for `hive`, or a two-RPC-agreeing Base USDC ERC-20
 * `Transfer` log for `base-usdc`. A rail with no wired verification (`bank`, `lightning`,
 * `platform`) refuses as data. Never throws for a domain-level mismatch — only for a malformed
 * request. A hive/base-usdc endpoint with no `walletId` (2026-09-05 ruling, payment-receivers-
 * are-parameters-never-literals) refuses as `endpoint-has-no-wallet`. This module reads the
 * bare address out of `walletId`; it does not itself gate on wallet custody -- that gate lives
 * in `derive-tips-page.mjs`, which is the render-time surface this ruling targets.
 */
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { verifyHbdPayment } from "@red-cup-engineering/x402-services-section/hbd/verify-payment";
import { findEndpoint, loadEndpoints } from "../src/tips.mjs";
import { runJavascriptNodeOperation } from "@red-cup-engineering/javascript-node-services-section/operation";

const require = createRequire(import.meta.url);

/** keccak256("Transfer(address,address,uint256)"), the ERC-20 settlement event. */
const ERC20_TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
/** USDC on Base, per x402-market-observation-service's own BASE_USDC constant. */
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const DEFAULT_BASE_RPC_URLS = ["https://mainnet.base.org/", "https://base-rpc.publicnode.com/"];

function refuse(reason, detail = undefined) {
  return { verified: false, reason, ...(detail === undefined ? {} : { detail }) };
}

/**
 * Extracts the bare address/account from a `"<chain>:<address>"` walletId, or `null` when the
 * endpoint carries none (2026-09-05 ruling, payment-receivers-are-parameters-never-literals: a
 * catalog endpoint never carries a literal `receiver` -- only a `walletId`).
 * @param {(string|null|undefined)} walletId
 * @returns {(string|null)}
 */
function addressFromWalletId(walletId) {
  const separatorIndex = typeof walletId === "string" ? walletId.indexOf(":") : -1;
  return separatorIndex > 0 ? walletId.slice(separatorIndex + 1) : null;
}

/**
 * Locates the installed `@red-cup-engineering/stripe-services-section` package directory via
 * Node's own module resolution, so this cross-package read never hand-writes a relative path.
 * @returns {string}
 */
function stripePackageRoot() {
  return dirname(require.resolve("@red-cup-engineering/stripe-services-section/package.json"));
}

async function verifyCardClaim(endpoint, claim, options) {
  if (typeof claim?.stripeEventId !== "string" || claim.stripeEventId.length === 0) {
    return refuse("invalid-claim", "claim.stripeEventId is required for the card rail");
  }
  const { createSemanticRecordJournal } = await import("@red-cup-engineering/semiotic-eavt-services-section/record-semantic-record");
  const journal = options.stripeJournal
    ?? createSemanticRecordJournal({ root: options.stripeJournalRoot ?? stripePackageRoot(), objectKind: "stripe.payment-service-record" });
  const rows = await journal.query({ category: "stripe-webhook-event-admission.events" });
  const record = rows.map((row) => row.record).find((row) => row.stripeEventId === claim.stripeEventId);
  if (!record) return refuse("not-found", "no ingested Stripe webhook event matches claim.stripeEventId");
  if (record.eventType !== "checkout.session.completed") return refuse("wrong-event-type", record.eventType);
  if (record.paymentStatus !== "paid" && record.paymentStatus !== "no_payment_required") return refuse("not-paid", record.paymentStatus);
  return {
    verified: true,
    receipt: {
      rail: "card",
      provider: endpoint.provider,
      receiver: endpoint.provider,
      amount: typeof record.amountTotal === "number" ? (record.amountTotal / 100).toFixed(2) : null,
      currency: typeof record.currency === "string" ? record.currency.toUpperCase() : null,
      receiptId: record.stripeEventId,
      verifiedAt: (options.now ?? new Date()).toISOString(),
    },
  };
}

async function verifyHiveClaim(endpoint, claim, options) {
  const payTo = addressFromWalletId(endpoint.walletId);
  if (!payTo) return refuse("endpoint-has-no-wallet", "this endpoint carries no walletId to verify a transfer against");
  for (const field of ["amount", "asset", "memo", "observedAt"]) {
    if (typeof claim?.[field] !== "string" || claim[field].length === 0) return refuse("invalid-claim", `claim.${field} is required for the hive rail`);
  }
  const nodes = Array.isArray(claim.nodes) && claim.nodes.length === 2 ? claim.nodes : ["https://api.hive.blog", "https://anyx.io"];
  const expiresAt = claim.expiresAt ?? new Date(Date.parse(claim.observedAt) + 30 * 24 * 60 * 60 * 1000).toISOString();
  const outcome = await verifyHbdPayment({
    requirement: { scheme: "hbd-transfer", network: "hive:mainnet", payTo, maxAmountRequired: claim.amount, asset: claim.asset, extra: { memo: claim.memo, expiresAt } },
    claim: { transactionId: claim.transactionId, block: claim.block, historyLimit: claim.historyLimit },
    nodes,
    observedAt: claim.observedAt,
    ...(claim.fixtureResponses ? { fixtureResponses: claim.fixtureResponses } : {}),
  });
  if (outcome.status !== "verified") return refuse(outcome.reason ?? "refused", outcome.detail);
  return {
    verified: true,
    receipt: {
      rail: "hive",
      provider: endpoint.provider,
      receiver: outcome.transfer.to,
      amount: outcome.transfer.amount,
      currency: outcome.transfer.asset,
      receiptId: outcome.transfer.transactionId,
      verifiedAt: (options.now ?? new Date()).toISOString(),
    },
  };
}

async function rpcCall(url, method, params, fetchImpl) {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!response.ok) return { ok: false, reason: `http ${response.status}` };
  const body = await response.json();
  if (body?.error) return { ok: false, reason: `rpc ${body.error.code ?? "?"}: ${body.error.message ?? "error"}` };
  if (body?.result === undefined) return { ok: false, reason: "malformed response: no result" };
  return { ok: true, value: body.result };
}

function decodeTransferLog(log, receiverTopic) {
  if (log?.topics?.[0] !== ERC20_TRANSFER_TOPIC || log.topics.length < 3) return null;
  if (log.topics[2].toLowerCase() !== receiverTopic) return null;
  return BigInt(log.data);
}

async function readUsdcTransfer(url, txHash, receiverTopic, fetchImpl) {
  const result = await rpcCall(url, "eth_getTransactionReceipt", [txHash], fetchImpl);
  if (!result.ok) return { found: false, error: result.reason };
  const logs = Array.isArray(result.value?.logs) ? result.value.logs : [];
  const match = logs.find((log) => log.address?.toLowerCase() === BASE_USDC.toLowerCase() && decodeTransferLog(log, receiverTopic) !== null);
  if (!match) return { found: false };
  return { found: true, rawValue: decodeTransferLog(match, receiverTopic), status: result.value?.status };
}

async function verifyBaseUsdcClaim(endpoint, claim, options) {
  const receiverAddress = addressFromWalletId(endpoint.walletId);
  if (!receiverAddress) return refuse("endpoint-has-no-wallet", "this endpoint carries no walletId to verify a transfer against");
  for (const field of ["amount", "txHash"]) {
    if (typeof claim?.[field] !== "string" || claim[field].length === 0) return refuse("invalid-claim", `claim.${field} is required for the base-usdc rail`);
  }
  const rpcUrls = Array.isArray(claim.rpcUrls) && claim.rpcUrls.length === 2 ? claim.rpcUrls : DEFAULT_BASE_RPC_URLS;
  const fetchImpl = options.fetchImpl ?? fetch;
  const receiverTopic = `0x${receiverAddress.replace(/^0x/iu, "").toLowerCase().padStart(64, "0")}`;
  const [a, b] = await Promise.all(rpcUrls.map((url) => readUsdcTransfer(url, claim.txHash, receiverTopic, fetchImpl)));
  if (a.error || b.error) return refuse("node-unavailable", a.error ?? b.error);
  if (!a.found || !b.found) return refuse("not-found", "the transaction has no USDC Transfer to this endpoint's receiver on at least one node");
  if (a.rawValue !== b.rawValue || a.status !== b.status) return refuse("nodes-disagree");
  if (a.status !== "0x1") return refuse("transaction-failed");
  const claimedRaw = BigInt(Math.round(Number.parseFloat(claim.amount) * 1_000_000));
  if (a.rawValue !== claimedRaw) return refuse("wrong-amount", `expected ${claim.amount} USDC (${claimedRaw} raw), found ${a.rawValue} raw`);
  return {
    verified: true,
    receipt: {
      rail: "base-usdc",
      provider: endpoint.provider,
      receiver: receiverAddress,
      amount: claim.amount,
      currency: "USDC",
      receiptId: claim.txHash,
      verifiedAt: (options.now ?? new Date()).toISOString(),
    },
  };
}

/**
 * Verifies one buyer-claimed tip receipt against the rail its endpoint moves value over. Never
 * throws for a domain-level mismatch or an unimplemented rail — both come back as a typed
 * `{verified: false, reason}` refusal.
 * @param {{endpointId: string, claim: object}} request The endpoint being claimed against and the rail-specific claim.
 * @param {{endpoints?: object, stripeJournal?: object, stripeJournalRoot?: string, fetchImpl?: Function, now?: Date}} [options]
 * @returns {Promise<{verified: true, receipt: object}|{verified: false, reason: string, detail?: *}>}
 * @throws {TypeError} When `request.endpointId` or `request.claim` is missing.
 */
export async function verifyTipReceipt({ endpointId, claim }, options = {}) {
  if (typeof endpointId !== "string" || endpointId.length === 0) throw new TypeError("verify-tip-receipt: endpointId must be a non-empty string");
  if (!claim || typeof claim !== "object") throw new TypeError("verify-tip-receipt: claim must be an object");
  const endpoint = findEndpoint(endpointId, options.endpoints ?? loadEndpoints());
  if (!endpoint) return refuse("unknown-endpoint", endpointId);
  if (endpoint.rail === "card") return verifyCardClaim(endpoint, claim, options);
  if (endpoint.rail === "hive") return verifyHiveClaim(endpoint, claim, options);
  if (endpoint.rail === "base-usdc") return verifyBaseUsdcClaim(endpoint, claim, options);
  return refuse("verification-not-implemented-for-rail", endpoint.rail);
}

if (import.meta.main) {
  const result = await runJavascriptNodeOperation({ name: "verify-tip-receipt", description: "Verifies one buyer-claimed tip receipt against the rail its endpoint moves value over.", operation: verifyTipReceipt }, { arguments: process.argv.slice(2), standardInput: process.stdin, standardOutput: process.stdout });
  process.exitCode = result.exitCode;
}
