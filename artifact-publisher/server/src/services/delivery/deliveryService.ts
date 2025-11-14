import crypto from 'crypto';
import { DeliveryRecord, LicenseDocument } from '../../types.js';
import { deterministicId } from '../../utils/deterministic.js';

export class DeliveryService {
  constructor(private readonly deliveryKey: string) {}

  deliver(orderId: string, license: LicenseDocument): DeliveryRecord {
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
