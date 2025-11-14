/**
 * localPlanner.ts
 *
 * Produce a structured plan using a local/offline LLM.
 *
 * This mirrors planner.ts but calls a local LLM (configured via LOCAL_LLM_URL)
 * instead of OpenAI. It attempts several common local-LLM endpoints and payload
 * shapes (OpenAI-compatible / text-generation-webui), and then normalizes the
 * returned text into a Plan object.
 *
 * Artifact guarantees: S3 artifact storage with checksum; artifact uploads produce
 * stored checksums linked to AuditEvents and `manifestSignatureId`.
 *
 * Public API:    localPlan(prompt: string, memory?: string[])
 */