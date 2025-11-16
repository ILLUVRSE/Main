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

import crypto from 'node:crypto';
import { URL } from 'node:url';
import http from 'node:http';
import https from 'node:https';
import { Readable } from 'stream';
import { S3Client, GetObjectCommand, GetObjectCommandOutput } from '@aws-sdk/client-s3';

function buildS3Client(): S3Client {
  const region = process.env.S3_REGION || process.env.AWS_REGION || 'us-east-1';
  const endpoint = process.env.S3_ENDPOINT;
  const accessKeyId = process.env.S3_ACCESS_KEY || process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET || process.env.AWS_SECRET_ACCESS_KEY;

  const cfg: any = { region };

  if (endpoint) {
    cfg.endpoint = endpoint;
    // allow connecting to local minio; force path style if needed
    cfg.forcePathStyle = String(process.env.S3_FORCE_PATH_STYLE ?? 'true') === 'true';
  }

  if (accessKeyId && secretAccessKey) {
    cfg.credentials = { accessKeyId, secretAccessKey };
  }

  return new S3Client(cfg);
}

const s3 = buildS3Client();

/**
 * Parse an s3:// URL into bucket + key.
 */
function parseS3Url(s3url: string): { bucket: string; key: string } {
  if (!s3url.startsWith('s3://')) throw new Error('Not an s3:// URL');
  const without = s3url.slice('s3://'.length);
  const slash = without.indexOf('/');
  if (slash <= 0) throw new Error('Invalid s3 URL (expected s3://bucket/key)');
  const bucket = without.slice(0, slash);
  const key = without.slice(slash + 1);
  return { bucket, key };
}

/**
 * Compute SHA-256 hex digest (lowercase) of a readable stream.
 */
function computeSha256FromStream(stream: Readable): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    stream.on('data', (chunk: Buffer) => {
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
async function getStreamForUrl(artifactUrl: string): Promise<Readable> {
  if (artifactUrl.startsWith('s3://')) {
    const { bucket, key } = parseS3Url(artifactUrl);
    const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
    const resp: GetObjectCommandOutput = await s3.send(cmd);
    const body = resp.Body;
    // resp.Body in Node is a readable stream. Type it defensively.
    if (!body) throw new Error(`S3 GetObject returned empty body for s3://${bucket}/${key}`);
    // If body is a Readable (Node), return it. Otherwise try to coerce.
    if ((body as any).pipe && typeof (body as any).pipe === 'function') {
      return body as unknown as Readable;
    }
    // If it's a web ReadableStream, convert
    if (typeof (body as any).getReader === 'function') {
      // Convert web ReadableStream to Node Readable
      const webStream = body as unknown as ReadableStream;
      const reader = (webStream as any).getReader();
      // create Node Readable from async iterator
      const nodeStream = Readable.from((async function* () {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            yield Buffer.from(value);
          }
        } finally {
          if (reader.releaseLock) reader.releaseLock();
        }
      })());
      return nodeStream;
    }
    // Fallback: try to coerce to Buffer/string
    throw new Error('Unsupported S3 body stream type');
  }

  // HTTP/HTTPS
  const parsed = new URL(artifactUrl);
  const lib = parsed.protocol === 'https:' ? https : http;

  return new Promise<Readable>((resolve, reject) => {
    const opts: http.RequestOptions = {
      method: 'GET',
      headers: { 'Accept-Encoding': 'identity' },
      timeout: 30_000
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
export async function computeSha256FromUrl(artifactUrl: string): Promise<string> {
  const stream = await getStreamForUrl(artifactUrl);
  return computeSha256FromStream(stream);
}

/**
 * Validate an artifact by computing the SHA-256 and comparing with expected.
 */
export async function validateArtifactChecksum(artifactUrl: string, expectedSha256: string): Promise<boolean> {
  if (!expectedSha256 || typeof expectedSha256 !== 'string') {
    throw new Error('expectedSha256 must be a hex string');
  }
  const computed = await computeSha256FromUrl(artifactUrl);
  return computed.toLowerCase() === expectedSha256.toLowerCase();
}

export default {
  computeSha256FromUrl,
  validateArtifactChecksum
};

