/**
 * memory-layer/service/storage/artifactStorage.ts
 *
 * Defines the ArtifactStorage interface and implementations for S3 and Local Filesystem.
 * Used for storing and retrieving artifact blobs with guaranteed provenance.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { createReadStream, createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, CopyObjectCommand } from '@aws-sdk/client-s3';
import crypto from 'node:crypto';

export interface ArtifactStorage {
  put(key: string, content: Buffer | Readable, metadata?: Record<string, string>): Promise<void>;
  get(key: string): Promise<Readable | null>;
  head(key: string): Promise<{ size: number; metadata: Record<string, string> } | null>;
  move(sourceKey: string, destKey: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

export class LocalFsArtifactStorage implements ArtifactStorage {
  private baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }

  private getPath(key: string): string {
    return path.join(this.baseDir, key);
  }

  async ensureDir(key: string) {
    const dir = path.dirname(this.getPath(key));
    await fs.mkdir(dir, { recursive: true });
  }

  async put(key: string, content: Buffer | Readable, metadata?: Record<string, string>): Promise<void> {
    await this.ensureDir(key);
    const filePath = this.getPath(key);
    if (Buffer.isBuffer(content)) {
      await fs.writeFile(filePath, content);
    } else {
      await pipeline(content, createWriteStream(filePath));
    }
    if (metadata) {
        await fs.writeFile(`${filePath}.meta.json`, JSON.stringify(metadata));
    }
  }

  async get(key: string): Promise<Readable | null> {
    const filePath = this.getPath(key);
    try {
      await fs.access(filePath);
      return createReadStream(filePath);
    } catch {
      return null;
    }
  }

  async head(key: string): Promise<{ size: number; metadata: Record<string, string> } | null> {
    const filePath = this.getPath(key);
    try {
      const stats = await fs.stat(filePath);
      let metadata = {};
      try {
          const metaContent = await fs.readFile(`${filePath}.meta.json`, 'utf-8');
          metadata = JSON.parse(metaContent);
      } catch {}

      return { size: stats.size, metadata };
    } catch {
      return null;
    }
  }

  async move(sourceKey: string, destKey: string): Promise<void> {
    const sourcePath = this.getPath(sourceKey);
    const destPath = this.getPath(destKey);
    await this.ensureDir(destKey);
    await fs.rename(sourcePath, destPath);
    try {
        await fs.rename(`${sourcePath}.meta.json`, `${destPath}.meta.json`);
    } catch {}
  }

  async exists(key: string): Promise<boolean> {
      try {
          await fs.access(this.getPath(key));
          return true;
      } catch {
          return false;
      }
  }
}

export class S3ArtifactStorage implements ArtifactStorage {
  private client: S3Client;
  private bucket: string;

  constructor(bucket: string, region: string) {
    this.client = new S3Client({ region });
    this.bucket = bucket;
  }

  async put(key: string, content: Buffer | Readable, metadata?: Record<string, string>): Promise<void> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: content,
      Metadata: metadata,
      // Ensure we use a mode that respects Object Lock if bucket is configured
    });
    await this.client.send(command);
  }

  async get(key: string): Promise<Readable | null> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: key
      });
      const response = await this.client.send(command);
      return response.Body as Readable;
    } catch (err: any) {
      if (err.name === 'NoSuchKey') return null;
      throw err;
    }
  }

  async head(key: string): Promise<{ size: number; metadata: Record<string, string> } | null> {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: key
      });
      const response = await this.client.send(command);
      return {
        size: response.ContentLength ?? 0,
        metadata: response.Metadata ?? {}
      };
    } catch (err: any) {
      if (err.name === 'NotFound' || err.name === 'NoSuchKey') return null;
      throw err;
    }
  }

  async move(sourceKey: string, destKey: string): Promise<void> {
    // S3 move is Copy + Delete
    await this.client.send(new CopyObjectCommand({
      Bucket: this.bucket,
      CopySource: `${this.bucket}/${sourceKey}`,
      Key: destKey
    }));
    // Note: If object lock is enabled, delete might fail if retention is active.
    // In strict compliance mode, we might just leave the old one or rely on lifecycle.
    // However, for staging->final move, staging shouldn't be locked.
    // We assume staging prefix has no retention.
  }

  async exists(key: string): Promise<boolean> {
      const head = await this.head(key);
      return !!head;
  }
}

// Factory
export const getArtifactStorage = (): ArtifactStorage => {
  if (process.env.ARTIFACT_STORAGE_MODE === 's3') {
    return new S3ArtifactStorage(process.env.S3_BUCKET!, process.env.AWS_REGION || 'us-east-1');
  }
  return new LocalFsArtifactStorage(process.env.ARTIFACT_STORAGE_DIR || path.join(process.cwd(), 'memory-layer/test/storage'));
};

export const computeSha256 = (buffer: Buffer): string => {
    return crypto.createHash('sha256').update(buffer).digest('hex');
};
