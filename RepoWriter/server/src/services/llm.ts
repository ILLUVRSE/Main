/**
 * server/src/services/llm.ts
 *
 * Adapter that re-exports the localllm service under the `llm` name
 * and provides a `streamLocalGenerate` helper with the same signature used
 * elsewhere (prompt, onChunk, onDone, onError).
 *
 * Isolation & governance: isolated high-trust environment, multi-sig for high-value actions, mTLS & OIDC for access.
 */
