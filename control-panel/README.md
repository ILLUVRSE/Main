## ControlPanel (Next.js App Router)

ControlPanel is the operator UI for Kernel upgrades, SentinelNet verdicts, and Reasoning Graph trace review. The current iteration focuses on bootstrapping the end-to-end flows: authentication, Kernel client wrappers, upgrades dashboard/detail views, approvals, apply/emergency flows, SentinelNet verdict display, and trace annotations.

### Prerequisites

- Node 18+
- `npm` (repo uses `package-lock.json`)
- Kernel API endpoint + bearer token (set `KERNEL_API_URL` and `KERNEL_CONTROL_PANEL_TOKEN`)
- Optional: SentinelNet + Reasoning Graph URLs, Signing proxy URL, OIDC id_token source

### Environment variables

Create `.env.local` in `control-panel/`:

```
KERNEL_API_URL=https://kernel.example.com
KERNEL_CONTROL_PANEL_TOKEN=...
REASONING_GRAPH_URL=https://reasoning.example.com
SENTINEL_URL=https://sentinelnet.example.com
SIGNING_PROXY_URL=https://signer.example.com
CONTROL_PANEL_SESSION_SECRET=replace-me
ADMIN_PASSWORD=local-dev-password        # fallback for local login
DEMO_OIDC_TOKEN=base64.jwt.token         # optional test id_token
```

If `KERNEL_API_URL` is omitted the app operates in **demo mode** with stubbed data.

### Development

```bash
cd control-panel
npm install
npm run dev
```

Browse to `http://localhost:3000/login`, authenticate (OIDC token or `ADMIN_PASSWORD` fallback), then explore:

- `/upgrades` — dashboard with filtering, status badges, CI indicator
- `/upgrades/[id]` — detail view, approvals, apply/emergency controls, SentinelNet verdict, trace annotations, audit trail
- `/audit` — audit explorer
- `/control-panel` — legacy admin tooling (still accessible for backwards compatibility)

### Architecture highlights

- **Authentication**: `/api/session` accepts an OIDC `id_token` (claims-based role mapping) or a local password fallback. Sessions are stored in an HTTP-only cookie signed via `CONTROL_PANEL_SESSION_SECRET`.
- **Kernel client**: `src/lib/kernelClient.ts` wraps the required Kernel endpoints (`/upgrades`, `/approve`, `/apply`), SentinelNet verdict fetches, Reasoning Graph traces, and audit lookups. Calls flow through `/api/kernel/*` so server-side env secrets remain private.
- **Signing**: `src/lib/signingProxy.ts` supports KMS/proxy-backed signing (`SIGNING_PROXY_URL`). Without one, a deterministic SHA-256 dev signature is produced (clearly marked for mock mode).
- **Upgrades UI**: pages under `src/app/upgrades/` power the main flows. The detail page handles approvals, apply/emergency flows (with ratification capture), trace annotations, audit display, and SentinelNet verdicts (blocking if policy denies).
- **Reasoning graph annotations**: operators can annotate trace nodes; annotations are persisted via `annotateReasoningNode`.

### Tests & linting

Run unit tests (once added) via `npm test`. Linting follows the base Next.js eslint config (`npm run lint`).

### Next steps

This initial scaffolding establishes the UI flows. Pending work (tracked in project issue tracker) includes:

- Wiring real SentinelNet + Reasoning Graph HTTP clients
- Emergency ratification workflow + Notification center
- CI/e2e pipeline (Playwright)
- Comprehensive docs/runbooks per the acceptance checklist
