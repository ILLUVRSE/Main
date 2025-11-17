File 64/136 — Frontend README (how to run the UI locally, build, test).

**Save as**

```
marketplace/ui/README.md
```

**Contents**

````md
# Illuvrse Marketplace — UI

This directory contains the Illuvrse Marketplace frontend built with **Next.js (App router)**, **TypeScript**, **Tailwind CSS**, and **React Query**. It is intended to be run alongside the `marketplace` backend server (which implements the Marketplace API).

> **Location:** `marketplace/ui`

---

## Quick start (development)

1. **Install dependencies**

```bash
cd marketplace/ui
npm ci
````

2. **Run the dev server**

```bash
npm run dev
# opens at http://localhost:3000 by default
```

The UI expects the Marketplace backend API to be available. By default it will call `NEXT_PUBLIC_MARKETPLACE_BASE_URL` (defaults to `http://127.0.0.1:3000`). If you use `marketplace/run-local.sh` to run the backend and mocks locally, the defaults should work.

### Environment variables

Create a `.env.local` (not checked in) or export environment variables:

```
NEXT_PUBLIC_MARKETPLACE_BASE_URL=http://127.0.0.1:3000
NEXT_PUBLIC_APP_ENV=dev
```

For agent features, the UI proxies calls to the backend agent via Next API routes, which in turn call the backend `MARKETPLACE_BASE` (see `ui/src/pages/api/agent/*`).

---

## Build & production

Build the Next.js app and run in production mode:

```bash
npm run build
npm start
```

Alternatively, build a Docker image (see `Dockerfile`):

```bash
# from marketplace/ui
docker build -t illuvrse-marketplace-ui:latest .
docker run -e NEXT_PUBLIC_MARKETPLACE_BASE_URL="https://api.illuvrse.com" -p 3000:3000 illuvrse-marketplace-ui:latest
```

---

## Testing

### Unit tests (Vitest)

```bash
npm run test:unit
```

### End-to-end (Playwright)

Start the app (or ensure `PW_BASE_URL` is set to a running instance), then:

```bash
npm run test:e2e
```

Playwright config lives at `playwright.config.ts` and e2e tests are in `tests/e2e/`.

---

## Storybook

To run component previews:

```bash
npm run storybook
# open http://localhost:6006
```

---

## Lint & format

```bash
npm run lint
npm run format
```

ESLint/Prettier configs are included.

---

## Architecture notes & conventions

* App Router (`/app`) powers pages. Client components use `'use client'`.
* API calls use `src/lib/api.ts` which normalizes the `{ ok: boolean }` envelope returned by the backend.
* Auth is a simple `AuthProvider` in `src/lib/auth.tsx` (dev-friendly). Replace with OIDC for production.
* Agent-related UI calls `POST /api/agent/query` which proxies to your Marketplace agent endpoint — the server is responsible for authorizing, auditing, and calling OpenAI Agent Builder.
* Admin pages expect operator authorization and call `/admin/*` backend endpoints that must be implemented server-side.

---

## Helpful links

* Backend acceptance criteria & runbooks: `marketplace/acceptance-criteria.md`, `marketplace/docs/PRODUCTION.md`
* Backend code (manifest validation, audit writer, finance): see the repository root `marketplace/` server files.

---

If you want, I can:

* Generate a `.env.local.example` with the common variables
* Add a `Makefile` or dev script that launches backend + UI + tests in one command
* Scaffold the server-side admin endpoints to match the UI (e.g., `/admin/signers`, `/admin/audit/export`)

Which would you like next?

```

