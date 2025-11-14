import crypto from 'crypto';
import { deterministicId } from '../../utils/deterministic.js';
export class DeliveryService {
    deliveryKey;
    constructor(deliveryKey) {
        this.deliveryKey = deliveryKey;
    }
    deliver(orderId, license) {
        const cipher = crypto
            .createHash('sha256')
            .update(`${this.deliveryKey}-${orderId}-${license.licenseKey}`)
            .digest('hex');
        return {
            deliveryId: deterministicId(`${orderId}-${license.licenseId}`, 'dlv'),
            artifactUrl: `https://delivery.artifacts.invalid/${orderId}`,
            cipherText: cipher,
        };
    }
}
