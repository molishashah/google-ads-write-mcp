# google-ads-write-mcp

A remote [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server for managing Google Ads — built on Next.js and deployable to Vercel. It exposes full-admin **read, write, reporting, research, conversion, ad, asset, campaign, experiment, and account** tools over an authenticated HTTP MCP endpoint, so an MCP client can operate Google Ads accounts without routine Google Ads UI usage.

Mutating operations support `validate_only` where Google exposes it. Remove/delete-style operations are intentionally available for full-admin workflows.

## How it works

The server uses a two-layer auth model:

- **Layer 1 — Google Ads access (service-account identity):** all Ads API calls are made with one Google Cloud service account that has been added as a user on the Google Ads manager/customer account. Individual MCP users never need their own Ads credentials.
- **Layer 2 — Team-member identity:** each user signs in with Google through the MCP OAuth handshake. We store only their email in a short-lived JWT (signed with `JWT_SECRET`); the actual Ads calls always use the service-account identity. Sign-in can be restricted to a single Workspace domain via `ALLOWED_DOMAIN`.

The MCP endpoint is served at `/api/[transport]` and protected by `withMcpAuth`. OAuth discovery documents are served from `/.well-known/`.

## Tools

| Tool | Description |
|------|-------------|
| `list_accessible_customers` | List Google Ads accounts the configured identity can access |
| Category | Tools |
|------|-------------|
| Access/search | `list_accessible_customers`, `search`, `search_stream`, `validate_gaql`, `discover_google_ads_fields`, `list_report_templates` |
| Campaigns | `create_campaign`, `create_search_campaign_bundle`, typed `create_performance_max_campaign_bundle`, channel campaign shell tools, campaign list/get/update/status/remove, budget, bidding, date, network, URL, targeting tools |
| Ad groups/keywords | `create_ad_group`, ad group list/get/update/status/remove, positive keywords, campaign/ad group negatives, shared negative keyword sets |
| Ads/assets/policy | `get_ad`, `create_responsive_search_ad`, `replace_responsive_search_ad`, typed `create_responsive_display_ad`, raw ad-format wrappers, asset create/list/get/remove/attach/detach, policy summary and ad-copy validation |
| Conversions | conversion action CRUD, typed offline/website conversion action creators, customer/campaign/custom goals, biddable goal helpers, value rules, custom variables, upload tools, upload capability check, diagnostics |
| Reporting/research | account/campaign/ad group/keyword/search term/ad/asset/landing page/geo/device/hour/conversion/change reports, keyword planning, recommendations, allowlist-aware insights |
| Experiments | ad-variation flow plus list/schedule/end/promote/remove/async-error tools |
| Account/admin | customer metadata, hierarchy, user access, manager/product links, billing/account-budget reads, change status, permission diagnostics |
| Full-admin escape hatches | `mutate_google_ads_resources`, `call_google_ads_service_method` |

## Tech stack

- **Next.js 16** (App Router) on **React 19**
- [`mcp-handler`](https://www.npmjs.com/package/mcp-handler) + [`@modelcontextprotocol/sdk`](https://www.npmjs.com/package/@modelcontextprotocol/sdk)
- [`google-ads-api`](https://www.npmjs.com/package/google-ads-api) v24.1.0 (Ads API client)
- `google-auth-library` + `jose` for OAuth and JWT
- `zod` for tool input validation

## Setup

### Prerequisites

- A Google Ads **manager (MCC) account** with a [developer token](https://developers.google.com/google-ads/api/docs/get-started/dev-token)
- A Google Cloud **service account** whose email has Google Ads account access
- A Google Cloud **OAuth 2.0 client** with `openid email profile` for MCP team-member identity

### Configure environment

Copy the example file and fill in your values:

```bash
cp .env.local.example .env.local
```

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_BASE_URL` | Base URL of the deployment (no trailing slash) |
| `GOOGLE_ADS_DEVELOPER_TOKEN` | Developer token from your MCC |
| `GOOGLE_APPLICATION_CREDENTIALS` | Local path to service-account JSON |
| `GOOGLE_APPLICATION_CREDENTIALS_JSON` | Inline service-account JSON for serverless/Vercel |
| `GOOGLE_ADS_LOGIN_CUSTOMER_ID` | Manager (MCC) account ID, no hyphens |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | OAuth client for MCP team-member sign-in |
| `JWT_SECRET` | Signs the MCP auth JWT — generate with `openssl rand -hex 32` |
| `ALLOWED_DOMAIN` | (Optional) restrict sign-in to one Workspace domain |

See `.env.local.example` for full notes.

Some Google Ads tasks may still require Google UI/support outside the API: initial account access, some billing/payment setup, advertiser verification, and allowlisted/beta API surfaces.

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
