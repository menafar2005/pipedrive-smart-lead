# Pipedrive Smart Assignment App

A Cloudflare Worker + D1 demo/private Pipedrive app.

## Features

- OAuth install flow
- App Settings page for user daily capacity
- Custom Lead Scoring modal
- JSON Lead Scoring modal
- Round-robin deal assignment with capacity skip
- Deal Sidebar / Panel with today's capacity summary
- Bitcoin JSON Panel
- Gemini-powered company analysis and sales strategy page
- Full Pipedrive App Extensions SDK test lab
- JWT validation for Pipedrive iframe/panel/modal requests
- Basic rate limiting with D1
- Complete backend and iframe/browser outbound API logging in D1 (`external_api_calls.call_source`)
- Admin check for saving settings

## Required Cloudflare secrets

```powershell
npx wrangler secret put PIPEDRIVE_CLIENT_ID
npx wrangler secret put PIPEDRIVE_CLIENT_SECRET
npx wrangler secret put PIPEDRIVE_JWT_SECRET
npx wrangler secret put GEMINIAPIKEY
```

Use the same `PIPEDRIVE_JWT_SECRET` in Pipedrive Developer Hub for Custom UI extensions, JSON Modal and JSON Panel.

## D1 tables

Run `schema.sql` against your remote D1 database:

```powershell
npx wrangler d1 execute pipedrive-smart-assignment-db --remote --file schema.sql
```

For an existing database, apply the migrations instead:

```powershell
npx wrangler d1 migrations apply pipedrive-smart-assignment-db --remote
```

## Deploy

```powershell
npm install
npx wrangler deploy
```

## Pipedrive URLs

- OAuth callback: `https://pipedrive-smart-lead.ehsan2005-ir.workers.dev/oauth/callback`
- OAuth start: `https://pipedrive-smart-lead.ehsan2005-ir.workers.dev/oauth/start`
- App settings iframe: `https://pipedrive-smart-lead.ehsan2005-ir.workers.dev/settings`
- Custom modal iframe: `https://pipedrive-smart-lead.ehsan2005-ir.workers.dev/custom-lead-scoring`
- JSON modal endpoint: `https://pipedrive-smart-lead.ehsan2005-ir.workers.dev/json-lead-scoring`
- Sidebar iframe: `https://pipedrive-smart-lead.ehsan2005-ir.workers.dev/sidebar`
- JSON panel endpoint: `https://pipedrive-smart-lead.ehsan2005-ir.workers.dev/bitcoin-panel`
- Organization link action: `https://pipedrive-smart-lead.ehsan2005-ir.workers.dev/company-sales-analysis`
- SDK test lab iframe / custom modal: `https://pipedrive-smart-lead.ehsan2005-ir.workers.dev/sdk-lab`

## Required Pipedrive scopes

- `base`
- `users:read`
- `deals:read`
- `deals:full`
- `contacts:read` (organizations, people, organization fields and notes)
- `activities:read`

## Notes

After enabling security, direct browser access to iframe/API endpoints should return 401 unless Pipedrive sends a valid JWT token.

Configure the company analysis extension as a Pipedrive **Link** in the **Organization details** location. Set its URL to `https://pipedrive-smart-lead.ehsan2005-ir.workers.dev/company-sales-analysis` and use the same JWT secret as `PIPEDRIVE_JWT_SECRET`.

Configure the SDK lab as a Pipedrive **Custom Modal** (or another Custom UI extension when testing surface-specific commands). Set its iframe URL to `https://pipedrive-smart-lead.ehsan2005-ir.workers.dev/sdk-lab` and use the same JWT secret as `PIPEDRIVE_JWT_SECRET`. Commands such as floating-window visibility and modal closing only work in their matching extension type.
