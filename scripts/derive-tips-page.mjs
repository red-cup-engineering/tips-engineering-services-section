#!/usr/bin/env node
/**
 * Derives the public tips page as one Markdown fragment: every `live` or `code-ready` endpoint
 * carrying a `walletId` is resolved through key-management-services-section's
 * `resolvePaymentReceiver` at render time (2026-09-05 ruling,
 * payment-receivers-are-parameters-never-literals) -- an endpoint whose wallet has no custody
 * entry verified `"agreed"` is OMITTED from the page and reported as a `refusals` row instead,
 * so a wallet the Group holds no verified key for is never rendered as a payable receiver. An
 * endpoint with no `walletId` (card/bank/lightning/platform rails, or a chain-backed endpoint
 * still `needs-wallet`) renders with no receiver identity, same as before. An endpoint in state
 * `needs-account`/`needs-wallet` is never listed on the page — it comes back as a `handsItems`
 * row instead, for the report, never the public site.
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolvePaymentReceiver } from "@red-cup-engineering/key-management-services-section/resolve-payment-receiver";
import {
  verifyEnvOnHost, verifyLocalEnvVariable, verifyLocalKeystoreFile, verifyRemoteKeystoreFileExistence, verifyWalletCustody,
} from "@red-cup-engineering/key-management-services-section/verify-set-of-wallet-custody";
import { findEnvFilesToScan, findRepoRoot, readEnvVariablesFromFiles } from "@red-cup-engineering/key-management-services-section/derive-set-of-wallets";
import { configRoot } from "@red-cup-engineering/key-management-services-section/keystore-paths";
import { loadEndpoints, packageRoot } from "../src/tips.mjs";

const require = createRequire(import.meta.url);

function addressesMatch(chain, left, right) {
  return (chain === "base" || chain === "ethereum") ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function parseWalletId(walletId) {
  const separatorIndex = walletId.indexOf(":");
  return { chain: walletId.slice(0, separatorIndex), address: walletId.slice(separatorIndex + 1) };
}

function defaultLoadRegistry() {
  const registryPath = require.resolve("@red-cup-engineering/key-management-services-section/wallet-registry.json");
  return JSON.parse(readFileSync(registryPath, "utf8"));
}

/**
 * Verifies custody for exactly the given walletIds' registry rows, mirroring
 * key-management-services-section's own CLI wiring so custody is checked the same way
 * everywhere it is checked.
 * @param {{registry: {wallets: readonly object[]}, walletIds: readonly string[]}} input
 * @returns {Promise<object>} A CustodyVerification record.
 */
export async function verifyCustodyForWalletIds({ registry, walletIds }) {
  const identities = walletIds.map(parseWalletId);
  const filteredRegistry = {
    ...registry,
    wallets: registry.wallets.filter((wallet) => identities.some(({ chain, address }) => wallet.chain === chain && addressesMatch(chain, wallet.address, address))),
  };
  const passphrase = process.env.KEY_PASSPHRASE;
  const backupRoot = process.env.KEY_BACKUP_ROOT;
  const checkoutRoot = findRepoRoot(packageRoot());
  const env = { ...readEnvVariablesFromFiles(findEnvFilesToScan({ checkoutRoot, houseConfigRoot: configRoot({}) })), ...process.env };
  return verifyWalletCustody({
    registry: filteredRegistry,
    checkLocalKeystore: (wallet) => verifyLocalKeystoreFile(wallet, { passphrase, backupRoot }),
    checkRemoteKeystore: (wallet) => verifyRemoteKeystoreFileExistence(wallet),
    checkEnvOnHost: (wallet) => verifyEnvOnHost(wallet),
    checkLocalEnv: (wallet) => verifyLocalEnvVariable(wallet, { env }),
  });
}

function instructionsFor(endpoint, resolvedAddress) {
  if (endpoint.rail === "hive") {
    return `Send an HBD or HIVE transfer to \`@${resolvedAddress}\` on the Hive blockchain. Any memo is welcome but not required — the transfer itself is the tip.`;
  }
  if (endpoint.rail === "base-usdc") {
    return `Send USDC on Base to \`${resolvedAddress}\`.`;
  }
  if (endpoint.rail === "card" && endpoint.provider === "Stripe Checkout") {
    return "Use the tip checkout link on this site to pay by card in any amount you choose.";
  }
  return `See ${endpoint.provider} for how to send.`;
}

/**
 * Derives the public tips-page Markdown fragment and the founder-hands report rows.
 * @param {{type: "TipEndpointSet", endpoints: object[]}} [endpoints] Defaults to this section's bundled 2026-09-05 record.
 * @param {{loadRegistry?: () => object, verifyCustody?: Function}} [options] Injection points for tests -- production defaults read the real registry and run real custody verification.
 * @returns {Promise<{type: "TipsPageFragment", markdown: string,
 *   handsItems: {id: string, provider: string, handsItem: string}[], refusals: object[],
 *   endpoints: object[]}>} `endpoints` is every rendered row (same rows the markdown lists),
 *   each carrying a `receiver` field set to its resolved address (wallet-backed rows) or `null`
 *   (rows with no walletId) -- the one place any consumer (this package's own markdown, a
 *   public site's params sync) reads a resolved, custody-verified receiver, rather than each
 *   consumer re-deriving or literally hardcoding one.
 */
export async function deriveTipsPage(endpoints = loadEndpoints(), options = {}) {
  const listed = endpoints.endpoints.filter((endpoint) => endpoint.state === "live" || endpoint.state === "code-ready");
  const pending = endpoints.endpoints.filter((endpoint) => (endpoint.state === "needs-account" || endpoint.state === "needs-wallet") && endpoint.handsItem);

  const walletBacked = listed.filter((endpoint) => endpoint.walletId);
  const resolvedAddressByWalletId = new Map();
  const refusals = [];
  if (walletBacked.length > 0) {
    const loadRegistry = options.loadRegistry ?? defaultLoadRegistry;
    const verifyCustody = options.verifyCustody ?? verifyCustodyForWalletIds;
    const registry = loadRegistry();
    const custodyVerification = await verifyCustody({ registry, walletIds: walletBacked.map((endpoint) => endpoint.walletId) });
    for (const endpoint of walletBacked) {
      const result = resolvePaymentReceiver({ walletId: endpoint.walletId, rail: endpoint.rail, registry, custodyVerification });
      if (result.refused) refusals.push(result);
      else resolvedAddressByWalletId.set(endpoint.walletId, result.address);
    }
  }

  const rendered = listed.filter((endpoint) => !endpoint.walletId || resolvedAddressByWalletId.has(endpoint.walletId));

  const lines = ["## Send a tip", "", "This is a tip: money sent because you want to, with no offer, product, or promise attached.", ""];
  for (const endpoint of rendered) {
    const resolvedAddress = endpoint.walletId ? resolvedAddressByWalletId.get(endpoint.walletId) : undefined;
    lines.push(`- **${endpoint.provider}** (${endpoint.state}) — ${instructionsFor(endpoint, resolvedAddress)}`);
  }

  return {
    type: "TipsPageFragment",
    markdown: `${lines.join("\n")}\n`,
    handsItems: pending.map(({ id, provider, handsItem }) => ({ id, provider, handsItem })),
    refusals,
    endpoints: rendered.map((endpoint) => ({ ...endpoint, receiver: endpoint.walletId ? resolvedAddressByWalletId.get(endpoint.walletId) : null })),
  };
}

if (import.meta.main) {
  if (process.argv.includes("--help")) {
    process.stdout.write("deriveTipsPage — Derives the public tips-page Markdown fragment and the founder-hands report rows.\n");
  } else {
    process.stdout.write(`${JSON.stringify(await deriveTipsPage())}\n`);
  }
}
