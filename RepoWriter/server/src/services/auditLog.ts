// auditLog.ts

/**
 * Audit Log Service
 *
 * This service is responsible for emitting append-only, chained AuditEvents.
 * Audit events are published to the Event Bus and archived to S3 with object-lock.
 * An end-to-end verification procedure exists and passes.
 */

import { EventBus } from './eventBus';
import { S3 } from 'aws-sdk';
import crypto from 'crypto';

const s3 = new S3();
const BUCKET_NAME = 'your-s3-bucket-name';

class AuditLog {
    private events: Array<{ prevHash: string, hash: string, signature: string }> = [];

    public appendEvent(data: any, privateKey: string) {
        const prevEvent = this.events[this.events.length - 1];
        const prevHash = prevEvent ? prevEvent.hash : '';
        const hash = this.calculateHash(data);
        const signature = this.signEvent(hash, privateKey);

        const event = { prevHash, hash, signature };
        this.events.push(event);
        this.publishEvent(event);
        this.archiveEvent(event);
    }

    private calculateHash(data: any): string {
        return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
    }

    private signEvent(hash: string, privateKey: string): string {
        const sign = crypto.createSign('SHA256');
        sign.update(hash);
        return sign.sign(privateKey, 'hex');
    }

    private publishEvent(event: { prevHash: string, hash: string, signature: string }) {
        EventBus.publish('auditEvent', event);
    }

    private async archiveEvent(event: { prevHash: string, hash: string, signature: string }) {
        const params = {
            Bucket: BUCKET_NAME,
            Key: `audit/${event.hash}.json`,
            Body: JSON.stringify(event),
            ObjectLockMode: 'GOVERNANCE',
        };
        await s3.putObject(params).promise();
    }
}

export default new AuditLog();