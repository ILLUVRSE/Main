# Changelog

## 2025-11-20
- Added hardened signer registry template plus documentation + README pointers.
- Introduced `kernel/ci/require_kms_check.sh` and wired it into Finance & Marketplace CI guard jobs.
- Delivered Finance mock service, run-local orchestration script, and proof verification tooling for local/E2E flows.
- Refreshed signoff templates across Kernel, Marketplace, and Finance with audit_event references.

## 2025-11-24
- Rebuilt `marketplace/ui` as the Illuvrse-branded Next.js site with App Router pages (`/`, `/marketplace`, `/projects`, `/projects/[id]`, `/tokens`) and editorial Header/Hero/Footer matching the supplied comps.
- Added typed design tokens (`src/styles/tokens.ts`), Tailwind integration, primitive UI kit, Storybook stories, and the design tokens page.
- Implemented project cards, preview/sign modals wired to a new Express mock API (`mock-api/`) plus `scripts/run-local.sh` to run API + Next together.
- Seeded mock data, added Vitest unit coverage for `ProjectCard`, and authored a Playwright e2e flow covering preview → signing → signed badge.
