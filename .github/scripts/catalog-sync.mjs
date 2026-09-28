#!/usr/bin/env node
/**
 * Fetches a published catalog bundle from sunmini-api, checks the Ed25519 signature against the app's embedded
 * catalog keys and every file's sha256, and writes the static tree (catalog.json, catalog.json.sig, films/, art/).
 * Zero dependencies (Node 20+): also runs as the deploy Action in the mirror repo (github-action/).
 *
 *   node catalog-sync.mjs --out DIR [--api URL] [--version N|latest] [--pubkeys HEX,HEX]
 * Prints the version written. Exit 1 on any check failure (nothing is written then).
 */
import { createHash, createPublicKey, verify } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync, renameSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";

// Active + spare catalog public keys (app/src/main/assets/catalog/public_key{,_spare}.hex).
const DEFAULT_KEYS = [
  "c0f290d739d0d102b68549013bc6c01c265917a8565b73e3f7227eefee3c22a8",
  "19d26aa04fdc3d18b1d1cbc623a3f492080f17c688bab8ec55278d68f9373981",
];

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith("--")) acc.push([a.slice(2), all[i + 1]?.startsWith("--") || all[i + 1] === undefined ? "true" : all[i + 1]]);
  return acc;
}, []));
const api = (args.api ?? "https://sunmini-api.sunmini.workers.dev").replace(/\/+$/, "");
const out = args.out;
if (!out) {
  console.error("usage: catalog-sync.mjs --out DIR [--api URL] [--version N|latest] [--pubkeys HEX,HEX]");
  process.exit(2);
}
const keys = (args.pubkeys ? args.pubkeys.split(",") : DEFAULT_KEYS).map((h) => h.trim().toLowerCase());

const spki = (hex) => createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(hex, "hex")]), format: "der", type: "spki" });
const sha = (b) => createHash("sha256").update(b).digest("hex");

async function get(url) {
  const r = await fetch(url, { headers: { "User-Agent": "sunmini-catalog-sync" } });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r;
}

const bundle = await (await get(`${api}/v1/publish/${args.version ?? "latest"}`)).json();
const catalogBytes = Buffer.from(bundle.catalog, "utf8");
const sig = Buffer.from(bundle.sig, "base64");
if (!keys.some((k) => /^[0-9a-f]{64}$/.test(k) && !/^0+$/.test(k) && verify(null, catalogBytes, spki(k), sig))) {
  console.error(`catalog v${bundle.version}: signature does not verify with ${keys.join(" / ")}`);
  process.exit(1);
}
if (sha(catalogBytes) !== bundle.catalogSha256) throw new Error("catalog sha256 mismatch");
const cat = JSON.parse(bundle.catalog);
if (cat.version !== bundle.version) throw new Error("bundle version mismatch");
const expected = new Map();
for (const f of cat.films) {
  expected.set(f.profileUrl, f.profileSha256);
  for (const a of Object.values(f.art ?? {})) expected.set(a.url, a.sha256);
}
for (const [rel, s] of Object.entries(bundle.files)) {
  if (expected.get(rel) !== s) throw new Error(`${rel}: not covered by the signed catalog`);
  if (rel.includes("..") || rel.startsWith("/")) throw new Error(`${rel}: bad path`);
}
if (expected.size !== Object.keys(bundle.files).length) throw new Error("bundle is missing files the catalog names");

const tmp = `${out}.tmp-${process.pid}`;
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });
for (const [rel, s] of Object.entries(bundle.files)) {
  const blob = Buffer.from(await (await get(`${api}/v1/publish/file/${s}`)).arrayBuffer());
  if (sha(blob) !== s) throw new Error(`${rel}: sha256 mismatch`);
  mkdirSync(dirname(join(tmp, rel)), { recursive: true });
  writeFileSync(join(tmp, rel), blob);
}
writeFileSync(join(tmp, "catalog.json"), catalogBytes);
writeFileSync(join(tmp, "catalog.json.sig"), bundle.sig + "\n");
if (existsSync(out)) rmSync(out, { recursive: true, force: true });
mkdirSync(dirname(out), { recursive: true });
renameSync(tmp, out);
console.log(bundle.version);
