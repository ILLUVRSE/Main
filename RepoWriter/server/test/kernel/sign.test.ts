import { describe, it, expect } from '@jest/globals';
import { signManifest } from '../../src/kernel/sign';

describe('Manifest Signing', () => {
    it('should sign the manifest and return a valid signature', async () => {
        const manifest = { data: 'test' };
        const { signedManifest, signature } = await signManifest(manifest);
        expect(signedManifest).toEqual(manifest);
        expect(typeof signature).toBe('string');
        expect(signature).toMatch(/^[0-9a-f]+$/i);
    });
});
