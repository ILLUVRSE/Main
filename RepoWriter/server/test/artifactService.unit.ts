// artifactService.unit.ts

import { uploadArtifact, validateChecksum } from '../src/services/artifactService';
import { describe, it, expect, vi } from 'vitest';

describe('Artifact Service', () => {
  it('should upload artifact and create checksum entry', async () => {
    // Mock artifact and expected behavior
    const artifact = { name: 'test-artifact', data: 'some data' };
    const manifestSignatureId = 'signature-id';

    await uploadArtifact(artifact, manifestSignatureId);
    // Add assertions to verify checksum entry creation
  });

  it('should validate checksum correctly', async () => {
    const artifactName = 'test-artifact';
    const expectedChecksum = 'expected-checksum';

    const isValid = await validateChecksum(artifactName, expectedChecksum);
    expect(isValid).toBe(true);
  });
});
