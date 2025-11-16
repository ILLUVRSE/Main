/**
 * memory-layer/service/storage/s3Client.ts
 *
 * Compatibility shim that exports the v3-based S3 helpers implemented in
 * s3Client_v3.ts. Keep this file so other modules can continue importing
 * from './s3Client' without requiring changes across the codebase.
 *
 * Exports:
 *  - computeSha256FromUrl(artifactUrl: string): Promise<string>
 *  - validateArtifactChecksum(artifactUrl: string, expectedSha256: string): Promise<boolean>
 *
 * IMPORTANT: The real implementation lives in s3Client_v3.ts.
 */

import s3v3 from './s3Client_v3';

// Re-export named functions
export const computeSha256FromUrl = s3v3.computeSha256FromUrl;
export const validateArtifactChecksum = s3v3.validateArtifactChecksum;

export default {
  computeSha256FromUrl,
  validateArtifactChecksum
};

