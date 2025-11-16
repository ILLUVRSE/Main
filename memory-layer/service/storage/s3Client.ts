/**
 * memory-layer/service/storage/s3Client.ts
 *
 * Helper utilities for S3/MinIO and generic HTTP(S) artifact access.
 *
 * Exports:
 *  - computeSha256FromUrl(artifactUrl: string): Promise<string>   // returns hex lowercase sha256
 *  - validateArtifactChecksum(artifactUrl: string, expectedSha256: string): Promise<boolean>
 *
 * Behavior:
 *  - Supports `s3://bucket/key...` URLs using aws-sdk S3 (v2).
 *  - Supports `https://...` and `http://...` URLs via Node https/http streaming.
 *  - Streams content and computes SHA-256 without buffering the entire file in memory.
 *
 * Environment (for S3/MinIO):
 *  - S3_ENDPOINT (optional)  - e.g., https://minio.local:9000
 *  - S3_REGION (optional)    - e.g., us-east-1
 *  - S3_ACCESS_KEY / S3_SECRET (optional) - used if not relying on IAM
 *  - S3_FORCE_PATH_STYLE=true (optional) - for MinIO
 */

import crypto from 'node:crypto';
import { URL } from 'node:url';
import http from 'node:http';
import https from 'node:https';
import { S3 } from 'aws-sdk';
import { Readable } from 'stream';

const s3Client = (() => {
  // create S3 client lazily (only if needed)
  let client: S3 | null = null;
  return () => {
    if (client) return client;
    const endpoint = process.env.S3_ENDPOINT;
    const region = process.env.S3_REGION || process.env.AWS_REGION || 'us-east-1';
    const accessKeyId = process.env.S3_ACCESS_KEY || process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = process.env.S3_SECRET || process.env.AWS_SECRET_ACCESS_KEY;

    const cfg: S3.ClientConfiguration = {
      region
    };

    if (endpoint) {
      cfg.endpoint = endpoint;
      cfg.s3ForcePathStyle = String(process.env.S3_FORCE_PATH_STYLE ?? 'true') === 'true';
    }
    if (accessKeyId && secretAccessKey) {
      cfg.credentials = { accessKeyId, secretAccessKey } as any;
    }

    client = new S3(cfg);
    return client;
  };
})();

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
    stream.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Parse an s3:// URL into bucket + key.
 * Throws on invalid s3 URL.
 */
function parseS3Url(s3url: string): { bucket: string; key: string } {
  // Accept s3://bucket/key or s3://bucket/key?query (query ignored)
  if (!s3url.startsWith('s3://')) {
    throw new Error('Not an s3:// URL');
  }
  // remove scheme
  const withoutScheme = s3url.slice('s3://'.length);
  const slashIndex = withoutScheme.indexOf('/');
  if (slashIndex <= 0) {
    throw new Error('Invalid s3 URL (expected s3://bucket/key)');
  }
  const bucket = withoutScheme.slice(0, slashIndex);
  const key = withoutScheme.slice(slashIndex + 1);
  return { bucket, key };
}

/**
 * Obtain a readable stream for the given artifactUrl.
 * Supports s3://, http:// and https://
 */
function getStreamForUrl(artifactUrl: string): Promise<Readable> {
  if (artifactUrl.startsWith('s3://')) {
    const { bucket, key } = parseS3Url(artifactUrl);
    const s3 = s3Client();
    const req = s3.getObject({ Bucket: bucket, Key: key });
    // getObject().createReadStream() can throw synchronously for missing params, so handle it.
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stream = (req as any).createReadStream() as Readable;
      return Promise.resolve(stream);
    } catch (err) {
      return Promise.reject(err);
    }
  }

  const parsed = new URL(artifactUrl);
  const isHttps = parsed.protocol === 'https:';
  const lib = isHttps ? https : http;

  return new Promise<Readable>((resolve, reject) => {
    const options: http.RequestOptions = {
      method: 'GET',
      headers: {
        // allow servers to send a compressed response; we hash the raw body
        'Accept-Encoding': 'identity'
      },
      timeout: 30_000 // 30s socket timeout (adjust if needed)
    };

    const req = lib.request(artifactUrl, options, (res) => {
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
  // normalize both to lowercase without prefix
  return computed.toLowerCase() === expectedSha256.toLowerCase();
}

export default {
  computeSha256FromUrl,
  validateArtifactChecksum
};

