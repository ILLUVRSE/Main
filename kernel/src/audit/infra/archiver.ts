import { AuditEvent } from '../../types';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

export interface AuditArchiver {
  archive(event: AuditEvent): Promise<void>;
}

export class S3AuditArchiver implements AuditArchiver {
  private s3: S3Client;
  private bucket: string;

  constructor(bucket: string, region: string = 'us-east-1') {
    this.bucket = bucket;
    // In production, creds are picked up from env or IAM role
    this.s3 = new S3Client({ region });
  }

  async archive(event: AuditEvent): Promise<void> {
    const date = new Date(event.ts || Date.now());
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');

    const key = `audit/${year}/${month}/${day}/${event.id}.json`;

    try {
      await this.s3.send(new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: JSON.stringify(event, null, 2),
        ContentType: 'application/json',
        ObjectLockMode: 'GOVERNANCE',
        // Example retention: 1 year from now.
        // Note: Real retention should probably be set on the bucket level default,
        // but the task says "archive to S3 with Object Lock (WORM) for each event"
        ObjectLockRetainUntilDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
      }));
      console.log(`[S3AuditArchiver] Archived event ${event.id} to s3://${this.bucket}/${key}`);
    } catch (err: any) {
      console.error(`[S3AuditArchiver] Failed to archive event ${event.id}: ${err.message}`);
      // We log but might not want to crash the request if archival fails,
      // or we might want to queue it. For now, we log error.
      // If strict compliance is required, we should throw.
      // The task says "Archives to S3". I will assume best effort or retry is handled by caller.
      throw err;
    }
  }
}

export class MockAuditArchiver implements AuditArchiver {
  async archive(event: AuditEvent): Promise<void> {
    console.log(`[MockAuditArchiver] Archived event ${event.id}`);
  }
}

export function getArchiver(): AuditArchiver {
  const bucket = process.env.AUDIT_ARCHIVE_BUCKET;
  if (bucket) {
    return new S3AuditArchiver(bucket, process.env.AWS_REGION);
  }
  return new MockAuditArchiver();
}
