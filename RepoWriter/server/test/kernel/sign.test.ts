// sign.test.ts

import { signManifest } from '../../src/kernel/sign';
import { expect } from 'chai';

describe('Manifest Signing', () => {
    it('should sign the manifest and return a valid signature', async () => {
        const manifest = { data: 'test' };
        const { signedManifest, signature } = await signManifest(manifest);
        expect(signedManifest).to.deep.equal(manifest);
        expect(signature).to.be.a('string'); // Add more validation for the signature
    });
});