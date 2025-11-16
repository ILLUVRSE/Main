"use strict";
/**
 * memory-layer/service/storage/s3Client_v3.ts
 *
 * S3/HTTP helper using AWS SDK v3 (@aws-sdk/client-s3).
 * Provides:
 *  - computeSha256FromUrl(artifactUrl: string): Promise<string>   // returns hex lowercase sha256
 *  - validateArtifactChecksum(artifactUrl: string, expectedSha256: string): Promise<boolean>
 *
 * Behavior:
 *  - Supports `s3://bucket/key...` using @aws-sdk/client-s3 GetObjectCommand.
 *  - Supports `https://...` and `http://...` URLs via Node https/http streaming.
 *  - Streams content and computes SHA-256 without buffering the entire file in memory.
 *
 * Notes:
 *  - This file intentionally avoids aws-sdk v2 and uses the modular v3 client.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeSha256FromUrl = computeSha256FromUrl;
exports.validateArtifactChecksum = validateArtifactChecksum;
const node_crypto_1 = __importDefault(require("node:crypto"));
const node_url_1 = require("node:url");
const node_http_1 = __importDefault(require("node:http"));
const node_https_1 = __importDefault(require("node:https"));
const stream_1 = require("stream");
const client_s3_1 = require("@aws-sdk/client-s3");
function buildS3Client() {
    const region = process.env.S3_REGION || process.env.AWS_REGION || 'us-east-1';
    const endpoint = process.env.S3_ENDPOINT;
    const accessKeyId = process.env.S3_ACCESS_KEY || process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = process.env.S3_SECRET || process.env.AWS_SECRET_ACCESS_KEY;
    const cfg = { region };
    if (endpoint) {
        cfg.endpoint = endpoint;
        // allow connecting to local minio; force path style if needed
        cfg.forcePathStyle = String(process.env.S3_FORCE_PATH_STYLE ?? 'true') === 'true';
    }
    if (accessKeyId && secretAccessKey) {
        cfg.credentials = { accessKeyId, secretAccessKey };
    }
    return new client_s3_1.S3Client(cfg);
}
const s3 = buildS3Client();
/**
 * Parse an s3:// URL into bucket + key.
 */
function parseS3Url(s3url) {
    if (!s3url.startsWith('s3://'))
        throw new Error('Not an s3:// URL');
    const without = s3url.slice('s3://'.length);
    const slash = without.indexOf('/');
    if (slash <= 0)
        throw new Error('Invalid s3 URL (expected s3://bucket/key)');
    const bucket = without.slice(0, slash);
    const key = without.slice(slash + 1);
    return { bucket, key };
}
/**
 * Compute SHA-256 hex digest (lowercase) of a readable stream.
 */
function computeSha256FromStream(stream) {
    return new Promise((resolve, reject) => {
        const hash = node_crypto_1.default.createHash('sha256');
        stream.on('data', (chunk) => {
            hash.update(chunk);
        });
        stream.on('end', () => {
            resolve(hash.digest('hex'));
        });
        stream.on('error', (err) => reject(err));
    });
}
/**
 * Get a Node Readable stream for the given artifact URL.
 * Supports s3://, http:// and https://
 */
async function getStreamForUrl(artifactUrl) {
    if (artifactUrl.startsWith('s3://')) {
        const { bucket, key } = parseS3Url(artifactUrl);
        const cmd = new client_s3_1.GetObjectCommand({ Bucket: bucket, Key: key });
        const resp = await s3.send(cmd);
        const body = resp.Body;
        // resp.Body in Node is a readable stream. Type it defensively.
        if (!body)
            throw new Error(`S3 GetObject returned empty body for s3://${bucket}/${key}`);
        // If body is a Readable (Node), return it. Otherwise try to coerce.
        if (body.pipe && typeof body.pipe === 'function') {
            return body;
        }
        // If it's a web ReadableStream, convert
        if (typeof body.getReader === 'function') {
            // Convert web ReadableStream to Node Readable
            const webStream = body;
            const reader = webStream.getReader();
            // create Node Readable from async iterator
            const nodeStream = stream_1.Readable.from((async function* () {
                try {
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done)
                            break;
                        yield Buffer.from(value);
                    }
                }
                finally {
                    if (reader.releaseLock)
                        reader.releaseLock();
                }
            })());
            return nodeStream;
        }
        // Fallback: try to coerce to Buffer/string
        throw new Error('Unsupported S3 body stream type');
    }
    // HTTP/HTTPS
    const parsed = new node_url_1.URL(artifactUrl);
    const lib = parsed.protocol === 'https:' ? node_https_1.default : node_http_1.default;
    return new Promise((resolve, reject) => {
        const opts = {
            method: 'GET',
            headers: { 'Accept-Encoding': 'identity' },
            timeout: 30000
        };
        const req = lib.request(artifactUrl, opts, (res) => {
            if (res.statusCode && res.statusCode >= 400) {
                reject(new Error(`HTTP ${res.statusCode} fetching ${artifactUrl}`));
                return;
            }
            resolve(res);
        });
        req.on('error', (err) => reject(err));
        req.on('timeout', () => {
            req.destroy(new Error('Request timed out'));
        });
        req.end();
    });
}
/**
 * Compute sha256 hex (lowercase) for a given artifact URL.
 */
async function computeSha256FromUrl(artifactUrl) {
    const stream = await getStreamForUrl(artifactUrl);
    return computeSha256FromStream(stream);
}
/**
 * Validate an artifact by computing the SHA-256 and comparing with expected.
 */
async function validateArtifactChecksum(artifactUrl, expectedSha256) {
    if (!expectedSha256 || typeof expectedSha256 !== 'string') {
        throw new Error('expectedSha256 must be a hex string');
    }
    const computed = await computeSha256FromUrl(artifactUrl);
    return computed.toLowerCase() === expectedSha256.toLowerCase();
}
exports.default = {
    computeSha256FromUrl,
    validateArtifactChecksum
};
