import { describe, it, expect } from 'vitest';
import { signManifest } from '../../src/kernel/sign';

describe('Manifest Signing', () => {
    it('should sign the manifest and return a valid signature', async () => {
        const manifest = { data: 'test' };
        const { signedManifest, signature } = await signManifest(manifest);
        expect(signedManifest).toEqual(manifest);
        expect(typeof signature).toBe('string');
        // signature may be a hex HMAC (hex) or base64 from signing proxy - accept either
        const isHex = /^[0-9a-fA-F]+$/.test(signature);
        const isBase64 = /^[A-Za-z0-9+/]+=*$/.test(signature);
        expect(isHex || isBase64).toBe(true);
    });
});

