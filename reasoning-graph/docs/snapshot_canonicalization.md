# Snapshot Canonicalization

This document describes the canonicalization rules used for reasoning-graph snapshots to ensure bit-for-bit compatibility with Kernel audit logs.

## Algorithm

The canonicalization algorithm processes a JSON object (or Go struct) and produces a byte sequence. The rules are:

1.  **Normalization**:
    *   Structs are converted to maps.
    *   Types are normalized to JSON-compatible primitives.
2.  **Map Sorting**:
    *   Map keys are sorted lexicographically (UTF-8 byte order).
    *   This matches `Object.keys(obj).sort()` in JavaScript.
3.  **Arrays**:
    *   Array order is **preserved**. It is the responsibility of the snapshot creator to sort arrays if deterministic order is required (e.g., list of IDs).
4.  **Serialization**:
    *   Encoded as JSON (UTF-8).
    *   **No HTML escaping**: Characters like `<`, `>`, `&` are left as is (unlike default Go `json.Marshal` which escapes them as `\u003c`, etc.).
    *   **No trailing newline**: The final output does not contain a trailing newline.
    *   **Whitespace**: No whitespace between keys/values (minified).

## Parity with Kernel

This implementation is verified to match the `kernel/src/signingProvider.ts` implementation `canonicalizePayload`.

## Verification

To verify a snapshot:
1. Load the JSON.
2. Extract the `payload` and metadata fields (id, root_ids, created_at, reasoning_graph_version, manifest_signature_id).
3. Canonicalize this object using the rules above.
4. Compute SHA-256 hash of the canonical bytes.
5. Verify the signature against the hash and the signer's public key (Ed25519).

Helper tool: `reasoning-graph/tools/verify_snapshot.ts`
