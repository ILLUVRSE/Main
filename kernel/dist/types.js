"use strict";
/**
 * kernel/src/types.ts
 *
 * Canonical TypeScript types for Kernel API & DB models.
 * These mirror the canonical definitions in kernel/data-models.md.
 *
 * API uses camelCase. DB uses snake_case. Keep a single mapping layer
 * in application code where needed.
 *
 * Do NOT put secrets here.
 */
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Acceptance criteria (short, testable)
 *
 * - All exported types align to the canonical fields in kernel/data-models.md.
 *   Test: `tsc` and run a quick compile; use these types in server handlers and ensure no missing/renamed fields.
 *
 * - Type coverage: DivisionManifest, AgentProfile, EvalReport, ManifestSignature, AuditEvent, MemoryNode, ResourceAllocation exist and are exported.
 *   Test: Import types into server code and compile with `tsc --noEmit`.
 *
 * - Optional: Add mapping helpers to convert from DB snake_case rows to camelCase API types and vice-versa.
 *   Test: Create a small unit test that maps a simulated DB row to the TS interface and run `ts-node`/`jest` to confirm shapes.
 */
