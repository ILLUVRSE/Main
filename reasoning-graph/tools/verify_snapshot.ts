
import * as fs from 'fs';
import * as crypto from 'crypto';
import * as path from 'path';

// Minimal reimplementation of canonicalization to ensure parity logic in verification tool
// or we can try to import if available. But for a standalone tool, self-contained is better.
// However, the task wants "Use Kernel signing primitives where available".

function canonicalize(obj: any): string {
    const normalize = (value: any): any => {
        if (value === null || typeof value !== 'object') return value;
        if (Array.isArray(value)) return value.map(normalize);
        const out: Record<string, any> = {};
        for (const key of Object.keys(value).sort()) {
            out[key] = normalize(value[key]);
        }
        return out;
    };
    return JSON.stringify(normalize(obj));
}

interface Snapshot {
    id: string;
    root_ids: string[];
    created_at: string;
    reasoning_graph_version: string;
    manifest_signature_id?: string;
    payload: any;
}

interface PersistedSnapshot extends Snapshot {
    snapshot_bytes_canonical_hash: string;
    signer_kid: string;
    signature: string;
}

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

function chunkBase64(input: string): string {
    return input.match(/.{1,64}/g)?.join('\n') || '';
}

function toPemFromDer(der: Buffer): string {
    const body = chunkBase64(der.toString('base64'));
    return `-----BEGIN PUBLIC KEY-----\n${body}\n-----END PUBLIC KEY-----\n`;
}

function normalizePublicKey(publicKey: string): string {
    if (!publicKey) throw new Error('Public key is empty');
    // If it looks like base64-encoded SPKI DER (Kernel format)
    if (!publicKey.includes('-----BEGIN')) {
        const raw = Buffer.from(publicKey, 'base64');
        return toPemFromDer(raw);
    }
    return publicKey;
}

async function main() {
    const snapshotPath = process.argv[2];
    const signersPath = process.argv[3];

    if (!snapshotPath || !signersPath) {
        console.error('Usage: ts-node verify_snapshot.ts <snapshot.json> <signers.json>');
        process.exit(1);
    }

    const snapshotContent = fs.readFileSync(snapshotPath, 'utf8');
    const snapshot: PersistedSnapshot = JSON.parse(snapshotContent);

    // 1. Reconstruct the object that was signed (The Snapshot part)
    // We need to extract the fields that are part of the Snapshot struct in Go.
    // Go struct: ID, RootIDs, CreatedAt, ReasoningGraphVer, ManifestSignatureID, Payload.
    const cleanSnapshot: Snapshot = {
        id: snapshot.id,
        root_ids: snapshot.root_ids,
        created_at: snapshot.created_at,
        reasoning_graph_version: snapshot.reasoning_graph_version,
        payload: snapshot.payload
    };
    if (snapshot.manifest_signature_id) {
        cleanSnapshot.manifest_signature_id = snapshot.manifest_signature_id;
    }

    // 2. Canonicalize
    const canonicalBytes = canonicalize(cleanSnapshot);

    // 3. Compute Hash
    const hash = crypto.createHash('sha256').update(canonicalBytes).digest();
    const hashBase64 = hash.toString('base64');

    console.log(`Computed Hash: ${hashBase64}`);
    console.log(`Stored Hash:   ${snapshot.snapshot_bytes_canonical_hash}`);

    if (hashBase64 !== snapshot.snapshot_bytes_canonical_hash) {
        console.error('Hash mismatch!');
        process.exit(1);
    }

    // 4. Verify Signature
    const signers = JSON.parse(fs.readFileSync(signersPath, 'utf8'));
    const signer = signers[snapshot.signer_kid];

    if (!signer) {
        console.error(`Signer ${snapshot.signer_kid} not found in ${signersPath}`);
        process.exit(1);
    }

    const publicKey = normalizePublicKey(signer.PublicKey || signer.public_key || signer.publicKey);
    const signature = Buffer.from(snapshot.signature, 'base64');

    // We signed the *hash* in Go.
    // crypto.verify(algorithm, data, key, signature)
    // If we used Ed25519, we typically sign the message.
    // If we signed the hash, we need to pass the hash as message.

    // Wait, Ed25519 usually signs the message content, not the hash (it hashes internally).
    // If Go's `ed25519.Sign` was called with `hash[:]`, then the "message" is the hash bytes.
    // So here we verify against the hash bytes.

    const verified = crypto.verify(null, hash, crypto.createPublicKey(publicKey), signature);

    if (verified) {
        console.log('Signature Verified!');
        process.exit(0);
    } else {
        console.error('Signature Verification Failed!');
        process.exit(1);
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
