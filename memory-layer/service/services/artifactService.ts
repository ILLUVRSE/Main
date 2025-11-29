/**
 * memory-layer/service/services/artifactService.ts
 *
 * Orchestrates artifact upload, checksum verification, DB persistence, and audit logging.
 * Enforces atomicity (or compensation) between storage and DB.
 */

import { Readable } from 'stream';
import { getArtifactStorage, computeSha256 } from '../storage/artifactStorage';
import { insertArtifact, insertAuditEvent, getPool, withClient } from '../db';
import { AuditContext, ArtifactInput } from '../types';
import { canonicalizePayload, computeAuditDigest, signAuditDigest } from '../audit/auditChain';

const storage = getArtifactStorage();

/**
 * Uploads an artifact and creates metadata + audit event.
 *
 * Flow:
 * 1. Compute SHA-256 (if buffer) or rely on caller to provide correct SHA (if stream, we verify later or trust caller for now).
 *    Note: For streams, we might need to pipe through a hash stream.
 * 2. Upload to storage (S3/Local).
 * 3. Insert into DB (idempotent on SHA+URL).
 * 4. Create Audit Event.
 *
 * Atomicity:
 * - If upload fails, DB is not touched.
 * - If DB fails, we should ideally cleanup the uploaded object (best effort).
 */
export async function uploadArtifact(
    nodeId: string | null,
    content: Buffer,
    filename: string,
    contentType: string,
    ctx: AuditContext
) {
    const sha256 = computeSha256(content);
    const sizeBytes = content.length;

    // Deterministic path: artifacts/<sha256>/<uuid> to allow same content with different metadata/context if needed,
    // or just artifacts/<sha256> if we want strict content-addressable.
    // Task says: s3://<bucket>/artifacts/<sha256>/<uuid> or similar.
    // To handle deduplication of storage, we could use artifacts/<sha256> directly.
    // If we use artifacts/<sha256>, we can check existence first.

    const storageKey = `artifacts/${sha256}`;

    // Check if exists in storage
    const exists = await storage.exists(storageKey);
    if (!exists) {
        await storage.put(storageKey, content, {
            'x-amz-meta-sha256': sha256,
            'x-amz-meta-filename': filename
        });
    }

    // Now insert DB
    const artifactInput: ArtifactInput = {
        artifactUrl: `s3://${process.env.S3_BUCKET || 'local'}/${storageKey}`,
        sha256,
        manifestSignatureId: ctx.manifestSignatureId,
        sizeBytes,
        createdBy: ctx.caller,
        metadata: { filename },
        s3Key: storageKey,
        contentType,
        storageClass: 'STANDARD',
        provenanceVerified: true // We computed SHA ourselves from content
    };

    let artifactId: string;
    let auditId: string;

    try {
        // Use a transaction to ensure artifact + audit are linked
        const res = await withClient(async (client) => {
            await client.query('BEGIN');

            try {
                // Insert Artifact
                const { rows: artRows } = await client.query<{id: string}>(`
                    INSERT INTO artifacts (
                        memory_node_id, artifact_url, sha256, manifest_signature_id, size_bytes,
                        created_by, metadata, s3_key, content_type, storage_class, provenance_verified
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                    ON CONFLICT (artifact_url, sha256) DO UPDATE
                    SET updated_at = now()
                    RETURNING id
                `, [
                    nodeId,
                    artifactInput.artifactUrl,
                    artifactInput.sha256,
                    artifactInput.manifestSignatureId,
                    artifactInput.sizeBytes,
                    artifactInput.createdBy,
                    JSON.stringify(artifactInput.metadata),
                    artifactInput.s3Key,
                    artifactInput.contentType,
                    artifactInput.storageClass,
                    artifactInput.provenanceVerified
                ]);

                const artId = artRows[0].id;

                // Create Audit Event
                const prevRes = await client.query<{ hash: string }>(`SELECT hash FROM audit_events ORDER BY created_at DESC LIMIT 1 FOR UPDATE`);
                const prevHash = prevRes.rows[0]?.hash ?? null;

                const auditPayload = {
                    action: 'artifact.upload',
                    artifactId: artId,
                    sha256: artifactInput.sha256,
                    s3Key: artifactInput.s3Key,
                    size: artifactInput.sizeBytes
                };

                const canonical = canonicalizePayload(auditPayload);
                const digest = computeAuditDigest(canonical, prevHash);
                const signature = await signAuditDigest(digest);

                 // Check strict signing requirements
                 const requireKms = String(process.env.REQUIRE_KMS ?? '').toLowerCase() === 'true';
                 const isProd = (process.env.NODE_ENV ?? '').toLowerCase() === 'production';
                 if (!signature && (requireKms || isProd)) {
                     throw new Error('audit signing required but no signature produced');
                 }

                const { rows: auditRows } = await client.query<{id: string}>(`
                    INSERT INTO audit_events (
                        event_type, memory_node_id, artifact_id, payload, hash, prev_hash, signature, manifest_signature_id, created_at
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
                    RETURNING id
                `, [
                    'memory.artifact.created',
                    nodeId,
                    artId,
                    auditPayload,
                    digest,
                    prevHash,
                    signature,
                    ctx.manifestSignatureId
                ]);

                await client.query('COMMIT');
                return { artifactId: artId, auditId: auditRows[0].id };
            } catch (err) {
                await client.query('ROLLBACK');
                throw err;
            }
        });

        artifactId = res.artifactId;
        auditId = res.auditId;

    } catch (err) {
        // Compensation: If we uploaded a new object but DB failed, we *could* delete it.
        // But since we use content-addressing (SHA), leaving it there is harmless (orphaned object).
        // It might be used by future uploads.
        // We log the error.
        console.error('Failed to insert artifact to DB:', err);
        throw err;
    }

    return { artifactId, auditId, sha256 };
}
