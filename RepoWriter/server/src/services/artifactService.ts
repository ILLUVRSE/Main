// artifactService.ts

/**
 * Service for handling artifact uploads to S3.
 * Ensures checksum entries are created and linked to AuditEvents.
 */

import { S3 } from 'aws-sdk';
import { createChecksum, logAuditEvent } from '../utils';

const s3 = new S3();

export const uploadArtifact = async (artifact, manifestSignatureId) => {
  const checksum = createChecksum(artifact);
  const params = {
    Bucket: 'your-bucket-name',
    Key: artifact.name,
    Body: artifact.data,
  };

  await s3.upload(params).promise();
  await logAuditEvent(checksum, manifestSignatureId);
};

export const validateChecksum = async (artifactName, expectedChecksum) => {
  const checksum = await getChecksumFromDatabase(artifactName);
  return checksum === expectedChecksum;
};
