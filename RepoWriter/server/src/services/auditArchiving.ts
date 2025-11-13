// auditArchiving.ts
/**
* Audit archiving service
* Archives audit events to S3 with object-lock.
*/
import AWS from 'aws-sdk';

const s3 = new AWS.S3();

async function archiveAuditEvent(event) {
    const params = {
        Bucket: 'your-audit-bucket',
        Key: `audit-events/${event.timestamp}.json`,
        Body: JSON.stringify(event),
        ObjectLockMode: 'GOVERNANCE', // or 'COMPLIANCE'
        ObjectLockRetainUntilDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) // 1 year
    };
    await s3.putObject(params).promise();
}

export { archiveAuditEvent };