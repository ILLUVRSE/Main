# Illuvrse Frontend & Design System

Next.js (App Router) experience + design system using the Illuvrse brand palette, typography, and hero comps. Everything is driven by explicit tokens (`src/styles/tokens.ts`) and showcased at `/tokens` + Storybook.

> Location: `marketplace/ui`

---

## Quick start

```bash
cd marketplace/ui
npm install
```

### Run the full stack locally

```
npm run dev:mock
```

`dev:mock` launches:

- `mock-api/server.js` (Express, port 4001) seeded from `mock-api/seed.json`
- Next.js dev server with `NEXT_PUBLIC_API_BASE_URL=http://localhost:4001`

Visit `http://localhost:3000` for the site and `http://localhost:3000/tokens` for the design tokens showcase.

### Manual environment variables

If you need to run servers separately, create `.env.local`:

```
NEXT_PUBLIC_API_BASE_URL=http://localhost:4001
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

## Authentication / OIDC

The storefront now performs real browser-based OIDC (Authorization Code + PKCE) via [`oidc-client-ts`](https://github.com/authts/oidc-client-ts).

1. Provision a client in your IdP and add a redirect such as `http://localhost:3000/oidc/callback`.
2. Populate `.env.local` with:

   ```bash
   NEXT_PUBLIC_OIDC_ISSUER=https://idp.example.com/realms/illuvrse
   NEXT_PUBLIC_OIDC_CLIENT_ID=illuvrse-marketplace-ui
   NEXT_PUBLIC_OIDC_REDIRECT_URI=http://localhost:3000/oidc/callback
   NEXT_PUBLIC_OIDC_SCOPE="openid profile email offline_access"
   ```

3. Start the UI (`npm run dev` or `npm run dev:mock`) and click **Join in** → the browser will redirect to your IdP and return with an access token and ID token that are stored in-memory and refreshed silently.

### Dev fallback (`DEV_SKIP_OIDC`)

- Local scripts export `DEV_SKIP_OIDC=true` / `NEXT_PUBLIC_DEV_SKIP_OIDC=true` by default. In this mode the UI exposes a prompt that validates against `ADMIN_PASSWORD` (server-side) and mints a short-lived signed token for mock use. Set `ADMIN_PASSWORD` in `.env.local` if you do not want to keep the default `changeme`.
- In CI you can set `NEXT_PUBLIC_MOCK_OIDC=true` (or `MOCK_OIDC=true`) to automatically inject a deterministic mock session without prompting or hitting a provider. Playwright uses this flag to exercise flows while still asserting that API calls include `Authorization: Bearer …`.

### Verifying OIDC locally

1. Set real OIDC env vars and run `npm run dev`.
2. Open the browser console, click **Join in**, and complete the IdP login.
3. Inspect any network call to `/api/*` and confirm an `Authorization` header is present (or `x-id-token` when only an ID token is available).
4. For mock/dev fallback, set `DEV_SKIP_OIDC=true` and run `curl -XPOST http://localhost:3000/api/dev-login -d '{"password":"changeme"}' -H 'Content-Type: application/json'` to verify the fallback guard works.

> **Security note:** Marketplace UI is a static/browser-only frontend, so tokens are stored in memory (and in `sessionStorage` for the OIDC library) rather than secure HTTP-only cookies. The IdP refresh token flow is handled via `oidc-client-ts` silent renew. Production deployments should terminate tokens at an API gateway if a backend becomes available.

---

## Key scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Next.js only (expects API already running) |
| `npm run dev:mock` | Starts mock API + Next (`scripts/run-local.sh`) |
| `npm run mock-api` | Runs the Express mock API by itself |
| `npm run build` & `npm start` | Production build & serve |
| `npm run storybook` | Storybook for primitives + Hero/ProjectCard |
| `npm run test` | Vitest unit tests (ProjectCard, etc.) |
| `npm run playwright:test` | Playwright e2e (uses `scripts/run-local.sh`) |

---

## Design system + brand notes

- **Tokens**: `src/styles/tokens.ts` exports colors (including accessible variants), spacing, typography, radii, and shadows.
- **Tailwind**: `tailwind.config.js` ingests tokens via `ts-node` and sets `important: true`. Custom fonts (Cormorant Garamond, Inter, Space Grotesk) load via `next/font`.
- **Pages**:
  - `/` hero replicates the supplied composition.
  - `/marketplace` + `/projects` render project grids/cards with preview/sign flows.
  - `/projects/[id]` shows manifest detail view.
  - `/tokens` visually documents the palette, typography stack, spacing, and radii per acceptance criteria.
- **Components**: Primitives live in `src/components/ui/*`; project modules in `src/components/projects/*`. Header/Footer/Hero mirror the provided comps with glow treatments and accessible contrast tweaks.

---

## Mock API

- Source: `mock-api/seed.json`
- Server: `mock-api/server.js` (Express, CORS enabled, ~300–700 ms delay)
- Endpoints:
  - `GET /api/projects`
  - `GET /api/projects/:id`
  - `POST /api/projects/:id/preview`
  - `POST /api/kernel/sign`

`scripts/run-local.sh` keeps the API and Next server synchronized and cleans up processes on exit.

---

## Testing

### Unit (Vitest + RTL)

```
npm run test
```

Includes coverage for `ProjectCard` (render + fallback) in `tests/unit/ProjectCard.test.tsx`. Add more cases under `tests/unit/`.

### End-to-end (Playwright)

```
npm run playwright:test
```

The `tests/e2e/illuvrse-flow.spec.ts` scenario walks through marketplace → preview modal → sign modal → verifies `manifestSignatureId` and `signed` badge. The Playwright config boots the coupled dev + mock servers automatically and sets `MOCK_OIDC=true` so that a synthetic token is populated without hitting the IdP (CI-safe). Unset `MOCK_OIDC` to exercise a real OIDC provider instead.

CI runs the same suite via `.github/workflows/marketplace-playwright-ci.yml`, which:

1. Builds the Next.js app.
2. Starts `npm run dev:mock` (mock API + UI).
3. Executes `npx playwright test` with `MOCK_OIDC=true`.
4. Uploads the Playwright HTML report for inspection.

---

## Storybook

```
npm run storybook
```

Stories exist for `Button`, `Modal`, `ProjectCard`, and `Hero`. Background tokens are available via the Storybook backgrounds addon for quick visual parity checks.

---

## Developer follow-ups

1. **Wire real Kernel signing** – swap `/api/kernel/sign` mock with the production Kernel gateway and surface error codes in `SignModal`.
2. **Add OIDC auth** – replace the stubbed `AuthProvider` with the real identity provider (and propagate tokens to API calls).
3. **Marketplace filters & pagination** – extend `/marketplace` with category, status, and price filters plus lazy loading for larger catalogs.
