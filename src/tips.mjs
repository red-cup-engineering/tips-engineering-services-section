/**
 * Domain algebra for the tips capability (2026-09-05 ruling,
 * accept-tips-through-every-endpoint): the rail vocabulary and the endpoint catalog every
 * script in this section reads, never re-declared per script.
 */
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

let cachedRoot;
/**
 * This package's own root directory, resolved lazily from `import.meta.url` on first need.
 * @returns {string}
 */
export function packageRoot() {
  if (cachedRoot === undefined) cachedRoot = dirname(fileURLToPath(import.meta.url).replace(/\/src\/tips\.mjs$/u, "/package.json"));
  return cachedRoot;
}

/** The rails a tip endpoint can move value over. */
export const TIP_RAILS = Object.freeze(["card", "bank", "hive", "base-usdc", "lightning", "platform"]);

/**
 * Reads the tip-endpoint catalog from disk.
 * @param {string} [path] Catalog file path; defaults to this package's bundled 2026-09-05 record.
 * @returns {{type: "TipEndpointSet", endpoints: object[]}} The parsed endpoint set.
 */
export function loadEndpoints(path = join(packageRoot(), "data/records/2026-09-05-tip-endpoints.json")) {
  const { readFileSync } = require("node:fs");
  return JSON.parse(readFileSync(path, "utf8"));
}

/**
 * Finds one endpoint by id.
 * @param {string} endpointId
 * @param {{type: "TipEndpointSet", endpoints: object[]}} [endpoints]
 * @returns {object|undefined} The matching endpoint record, or `undefined` when no endpoint has that id.
 */
export function findEndpoint(endpointId, endpoints = loadEndpoints()) {
  return endpoints.endpoints.find((endpoint) => endpoint.id === endpointId);
}

/**
 * Capitalizes each hyphen- or space-separated word of an account/provider name into one
 * Beancount account component (e.g. `"buy me a coffee"` -> `"Buy-Me-A-Coffee"`), leaving a
 * word that starts with a digit unchanged.
 * @param {string} text
 * @returns {string}
 */
export function toAccountComponent(text) {
  return String(text)
    .trim()
    .split(/[\s-]+/u)
    .filter(Boolean)
    .map((word) => (/^\d/u.test(word) ? word : `${word.charAt(0).toUpperCase()}${word.slice(1)}`))
    .join("-");
}
