# HistoricalGeography.io

Interactive map showing what real places looked like centuries ago. See `CLAUDE.md` for the project brief and rules.

## Develop

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## Deploy

Hosted on Vercel. In the Vercel project settings, set **Root Directory** to `historicalgeography`.

## Tile storage (Cloudflare R2)

The map's large files (`*.pmtiles`: the landscape and the old-map overlays)
can be served from a Cloudflare R2 bucket instead of from the site, so the
deployment stays small as more historical maps are added. Until this is set
up, the site serves them itself.

One-time setup:

1. Create a free Cloudflare account at https://dash.cloudflare.com/sign-up.
2. In the dashboard, open **R2 Object Storage**, enable it (the free tier
   covers this project; a card may be required), and **Create bucket** named
   `historicalgeography-tiles`.
3. In the bucket's **Settings**:
   - **Public access**: either connect a custom domain such as
     `tiles.historicalgeography.io` (recommended; your domain must be on
     Cloudflare DNS), or enable the **r2.dev subdomain** for testing.
   - **CORS policy**: paste the contents of `scripts/r2-cors.json`.
4. Create an API token: **R2 → Manage R2 API Tokens → Create API token**
   with *Object Read & Write* on that bucket. Note the token and your
   **Account ID** (shown on the R2 overview page).
5. Upload the files. Easiest: let GitHub do it. In the GitHub repository,
   **Settings → Secrets and variables → Actions → New repository secret**,
   add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`; then **Actions →
   Upload tiles to R2 → Run workflow**. It also runs by itself whenever tile
   files change. Or upload from your computer:
   ```bash
   CLOUDFLARE_API_TOKEN=<token> CLOUDFLARE_ACCOUNT_ID=<account id> \
     node scripts/upload-tiles.mjs historicalgeography-tiles
   ```
   Re-run it after rebuilding tiles; it only uploads files that changed.
6. In Vercel: **Project → Settings → Environment Variables**, add
   `NEXT_PUBLIC_TILES_BASE_URL` = the bucket's public URL (for example
   `https://tiles.historicalgeography.io`), for Production and Preview, then
   redeploy.

Never commit the token. It only lives in your shell (or a password manager).
