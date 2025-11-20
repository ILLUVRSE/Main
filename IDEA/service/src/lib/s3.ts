import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getConfig } from '../config';
import { createHash } from 'crypto';
import { createReadStream } from 'fs';
import path from 'path';

const cfg = getConfig();

const s3 = new S3Client({
  region: cfg.s3Region,
  endpoint: cfg.s3Endpoint,
  forcePathStyle: Boolean(cfg.s3Endpoint),
  credentials: cfg.s3AccessKey && cfg.s3Secret
    ? { accessKeyId: cfg.s3AccessKey, secretAccessKey: cfg.s3Secret }
    : undefined
});

export async function presignPackageUpload(key: string): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: cfg.s3Bucket,
    Key: key
  });
  return getSignedUrl(s3, command, { expiresIn: 15 * 60 });
}

export async function sha256FromS3(key: string): Promise<{ sha256: string; size: number }> {
  try {
    const command = new GetObjectCommand({
      Bucket: cfg.s3Bucket,
      Key: key
    });
    const response = await s3.send(command);
    if (!response.Body) {
      throw new Error('S3 object body empty');
    }

    const hash = createHash('sha256');
    let size = 0;
    const body = response.Body as NodeJS.ReadableStream;
    await new Promise<void>((resolve, reject) => {
      body.on('data', (chunk) => {
        hash.update(chunk);
        size += chunk.length;
      });
      body.on('end', () => resolve());
      body.on('error', (err) => reject(err));
    });

    return { sha256: hash.digest('hex'), size };
  } catch (err) {
    if (!process.env.DEV_PACKAGE_DIR) {
      throw err;
    }
    const filePath = path.join(process.env.DEV_PACKAGE_DIR, key);
    const hash = createHash('sha256');
    let size = 0;
    await new Promise<void>((resolve, reject) => {
      const stream = createReadStream(filePath);
      stream.on('data', (chunk) => {
        hash.update(chunk);
        size += chunk.length;
      });
      stream.on('end', () => resolve());
      stream.on('error', (e) => reject(e));
    });
    return { sha256: hash.digest('hex'), size };
  }
}
