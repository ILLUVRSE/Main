import { deterministicHash, deterministicId } from '../../utils/deterministic.js';
export class LicenseService {
    issue(customerId, proof) {
        const licenseBase = `${customerId}-${proof.payloadHash}`;
        return {
            licenseId: deterministicId(licenseBase, 'lic'),
            licenseKey: deterministicHash(licenseBase).slice(0, 32),
            issuedTo: customerId,
            expiresAt: new Date('2099-01-01T00:00:00.000Z').toISOString(),
        };
    }
}
