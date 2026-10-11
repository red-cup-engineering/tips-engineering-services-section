#!/usr/bin/env node
/**
 * The composed tips-services-section CLI: verify a claimed tip, book a verified one, or derive
 * the public tips page, over one subcommand argument (`verify` | `book` | `page`), reading its
 * request as JSON from stdin (`page` takes none).
 */
import { parseArgs } from "node:util";
import { loadEndpoints } from "../src/tips.mjs";
import { bookTip } from "../scripts/book-tip.mjs";
import { deriveTipsPage } from "../scripts/derive-tips-page.mjs";
import { verifyTipReceipt } from "../scripts/verify-tip-receipt.mjs";

async function readStdin() {
  let text = "";
  for await (const chunk of process.stdin) text += chunk;
  return text;
}

async function main() {
  const { positionals } = parseArgs({ allowPositionals: true, options: {} });
  const [command] = positionals;
  if (command === "verify") {
    process.stdout.write(`${JSON.stringify(await verifyTipReceipt(JSON.parse(await readStdin())))}\n`);
  } else if (command === "book") {
    process.stdout.write(`${JSON.stringify(bookTip(JSON.parse(await readStdin())))}\n`);
  } else if (command === "page") {
    process.stdout.write(`${JSON.stringify(await deriveTipsPage())}\n`);
  } else if (command === "endpoints") {
    process.stdout.write(`${JSON.stringify(loadEndpoints())}\n`);
  } else {
    process.stderr.write("usage: tips-cli <verify|book|page|endpoints>\n");
    process.exitCode = 2;
  }
}

if (import.meta.main) await main();
