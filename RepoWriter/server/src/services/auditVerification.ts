// auditVerification.ts
/**
* Audit verification tooling
* Provides functions to validate the integrity of the audit chain.
*/

function verifyAuditChain(events) {
    for (let i = 1; i < events.length; i++) {
        const currentEvent = events[i];
        const previousEvent = events[i - 1];
        // Check if the previous hash matches
        if (currentEvent.prevHash !== previousEvent.hash) {
            return false; // Chain is invalid
        }
    }
    return true; // Chain is valid
}

export { verifyAuditChain };