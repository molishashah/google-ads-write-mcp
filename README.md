# google-ads-write-mcp

A remote [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server for managing Google Ads — built on Next.js and deployable to Vercel. It exposes a focused set of **read and write** tools (create campaigns, ad groups, keywords, responsive search ads, run experiments) over an authenticated HTTP MCP endpoint, so an MCP client like Claude can operate a Google Ads account on your behalf.

By design, mutating operations are **reversible** (pause, not delete). There are intentionally no `remove`/`delete` tools.

## How it works

The server uses a two-layer auth model:

- **Layer 1 — Google Ads access (single shared identity):** all Ads API calls are made with one refresh token scoped to `adwords`, minted once against a manager (MCC) account. Individual users never need their own Ads credentials.
- **Layer 2 — Team-member identity:** each user signs in with Google through the MCP OAuth handshake. We store only their email in a short-lived JWT (signed with `JWT_SECRET`); the actual Ads calls always use the shared refresh token. Sign-in can be restricted to a single Workspace domain via `ALLOWED_DOMAIN`.

The MCP endpoint is served at `/api/[transport]` and protected by `withMcpAuth`. OAuth discovery documents are served from `/.well-known/`.

## Tools

| Tool | Description |
|------|-------------|
| `list_accessible_customers` | List Google Ads accounts the configured identity can access |
| `search` | Run a GAQL (Google Ads Query Language) query — the general read tool |
| `search_to_artifact` | Run a GAQL read query and return only metadata; the full result rows are stored as a JSON artifact for later download (use for large result sets to keep rows out of the agent context) |
| `get_ad` | Fetch details for a specific ad |
| `create_campaign` | Create a campaign (with budget) |
| `create_ad_group` | Create an ad group under a campaign |
| `create_responsive_search_ad` | Create a responsive search ad (RSA) |
| `add_keywords` | Add keywords to an ad group |
| `add_negative_keywords` | Add negative keywords |
| `create_ad_variation` | Create an ad-variation experiment (control/treatment) |
| `get_experiment_status` | Check experiment status |
| `graduate_experiment` | Graduate an experiment to a permanent campaign |
| `pause_campaign` | Pause a campaign |
| `pause_ad_group` | Pause an ad group |
| `pause_ad` | Pause an ad |

## Tech stack

- **Next.js 16** (App Router) on **React 19**
- [`mcp-handler`](https://www.npmjs.com/package/mcp-handler) + [`@modelcontextprotocol/sdk`](https://www.npmjs.com/package/@modelcontextprotocol/sdk)
- [`google-ads-api`](https://www.npmjs.com/package/google-ads-api) v23 (Ads API client)
- [`@vercel/blob`](https://www.npmjs.com/package/@vercel/blob) for durable `search_to_artifact` storage
- `google-auth-library` + `jose` for OAuth and JWT
- `zod` for tool input validation

## Setup

### Prerequisites

- A Google Ads **manager (MCC) account** with a [developer token](https://developers.google.com/google-ads/api/docs/get-started/dev-token)
- A Google Cloud **OAuth 2.0 client** with these consent-screen scopes:
  - `openid email profile` (team-member identity)
  - `https://www.googleapis.com/auth/adwords` (refresh-token minting)

### Configure environment

Copy the example file and fill in your values:

```bash
cp .env.local.example .env.local
```

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_BASE_URL` | Base URL of the deployment (no trailing slash) |
| `GOOGLE_ADS_DEVELOPER_TOKEN` | Developer token from your MCC |
| `GOOGLE_ADS_REFRESH_TOKEN` | Shared refresh token (scope: `adwords`) |
| `GOOGLE_ADS_LOGIN_CUSTOMER_ID` | Manager (MCC) account ID, no hyphens |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | OAuth client, reused for minting + runtime sign-in |
| `JWT_SECRET` | Signs the MCP auth JWT — generate with `openssl rand -hex 32` |
| `ALLOWED_DOMAIN` | (Optional) restrict sign-in to one Workspace domain |
| `BLOB_READ_WRITE_TOKEN` | (Production) Vercel Blob read/write token. Enables durable artifact storage for `search_to_artifact`. Auto-injected when a Blob store is linked to the Vercel project; set manually for local testing against a real store |
| `ARTIFACT_BACKEND` | (Optional) force the artifact backend: `vercel_blob` or `filesystem`. Default: `vercel_blob` when `BLOB_READ_WRITE_TOKEN` is set, otherwise `filesystem` |
| `ARTIFACT_DIR` | (Optional) directory for the **filesystem** backend. Defaults to `<os.tmpdir()>/google-ads-mcp-artifacts` |
| `ARTIFACT_BLOB_ACCESS` | (Optional) `private` (default) or `public` for stored blobs. Leave as `private` unless your Blob store lacks private access |

### Artifact storage (`search_to_artifact`)

`search_to_artifact` runs a GAQL read query but, instead of returning the rows inline, serialises them to a JSON array, stores the bytes, and returns **metadata only** (id, size, sha256, row count) plus a short-lived signed `download_url`. This keeps large result sets out of the agent's context window.

Two backends, selected by `ARTIFACT_BACKEND` (or auto-detected):

- **`vercel_blob` (production).** Stores **private** blobs on [Vercel Blob](https://vercel.com/docs/storage/vercel-blob). Durable and the correct choice for the deployed serverless app. Link a Blob store to the project (`vercel blob` / dashboard) so `BLOB_READ_WRITE_TOKEN` is available.
- **`filesystem` (local/dev).** Writes under `ARTIFACT_DIR`. **Not durable in production** — on Vercel only `/tmp` is writable and it is ephemeral and per-instance, so an artifact written by one request may be gone from the next. Use it only for local development and smoke tests.

Bytes are retrieved via `GET /api/artifacts/:id?token=…`, which streams the raw artifact as an attachment (never JSON through an MCP response, so rows don't re-enter the agent context). The `token` is a short-lived (15 min) HMAC signed with `JWT_SECRET`; the blob itself stays private. There is intentionally **no `get_artifact` MCP tool** — that would recreate the context-bloat problem.

Example `search_to_artifact` response (metadata only):

```json
{
  "status": "ok",
  "artifact": {
    "id": "art_3f8c2a1b9d7e4c6a8b2f1e0d5a4c7b90",
    "name": "search-art_3f8c2a1b9d7e4c6a8b2f1e0d5a4c7b90.json",
    "mime_type": "application/json",
    "compression": "none",
    "byte_size": 9795,
    "sha256": "36e03f5ce029…",
    "row_count": 50,
    "download_url": "https://<deployment>/api/artifacts/art_3f8c2a1b…?token=1750800000.AbC…"
  },
  "query": {
    "customer_id": "9232939339",
    "resource": "campaign",
    "fields": ["campaign.id", "campaign.name", "campaign.status"],
    "conditions": null,
    "orderings": null,
    "limit": 50
  }
}
```

Download the full rows later (checksum verifiable against `artifact.sha256`):

```bash
curl -L "$DOWNLOAD_URL" -o rows.json
shasum -a 256 rows.json   # matches artifact.sha256
```

See `.env.local.example` for full notes, including how to mint the refresh token.

### Run locally

```bash
npm install
npm run dev
```

The MCP endpoint will be available at `http://localhost:3000/api/mcp`.

## Deploy

Deploy to [Vercel](https://vercel.com) (the project is configured for it). Set all environment variables above in the Vercel project settings, and set `NEXT_PUBLIC_BASE_URL` to your production URL.

## Connecting a client

Point your MCP client at the deployed endpoint, e.g. for Claude Code:

```bash
claude mcp add --transport http google-ads-write https://<your-deployment>/api/mcp
```

On first connect you'll be prompted to sign in with Google to complete the OAuth handshake.

## License

Private / unpublished (`"private": true`).
