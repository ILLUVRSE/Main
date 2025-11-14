import { deterministicId } from '../../utils/deterministic.js';
export class LedgerMock {
    ledgerId;
    constructor(ledgerId) {
        this.ledgerId = ledgerId;
    }
    record(amount, currency) {
        const base = JSON.stringify({ ledgerId: this.ledgerId, amount, currency });
        return {
            entryId: deterministicId(base, 'fin'),
            ledgerId: this.ledgerId,
            credit: amount,
            debit: 0,
            currency,
        };
    }
}
