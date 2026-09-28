# sunmini-catalog

Signed film catalog for the Sunmini app (static, public): the GitHub Pages fallback host. Primary host:
`https://sunmini-catalog.sunmini.workers.dev/v1/`. Content comes from the Sunmini admin (publish → sunmini-api);
`.github/workflows/deploy-catalog.yml` copies each published version here after checking its Ed25519 signature and
sha256s, and deploys it to Cloudflare when the `CLOUDFLARE_API_TOKEN` secret is set. Do not edit `v1/` by hand.
