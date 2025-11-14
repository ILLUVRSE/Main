export class KernelClient {
    baseUrl;
    constructor(baseUrl) {
        this.baseUrl = baseUrl;
    }
    async health() {
        const res = await fetch(`${this.baseUrl}/health`);
        return res.ok;
    }
    async logAudit(event) {
        const res = await fetch(`${this.baseUrl}/audit/log`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ event }),
        });
        if (!res.ok) {
            throw new Error(`Kernel audit log failed with status ${res.status}`);
        }
        const body = await res.json();
        return body;
    }
    async runMultisigUpgrade(request) {
        const createRes = await fetch(`${this.baseUrl}/multisig/upgrade`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(request),
        });
        if (!createRes.ok) {
            throw new Error(`Kernel upgrade create failed with status ${createRes.status}`);
        }
        const upgrade = await createRes.json();
        for (const approver of request.approvers) {
            const approveRes = await fetch(`${this.baseUrl}/multisig/upgrade/${upgrade.upgradeId}/approve`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ approver }),
            });
            if (!approveRes.ok) {
                throw new Error(`Kernel approval failed for ${approver}`);
            }
        }
        const applyRes = await fetch(`${this.baseUrl}/multisig/upgrade/${upgrade.upgradeId}/apply`, {
            method: 'POST',
        });
        if (!applyRes.ok) {
            throw new Error(`Kernel apply failed with status ${applyRes.status}`);
        }
        const applied = await applyRes.json();
        return {
            upgradeId: upgrade.upgradeId,
            approvals: applied.approvals,
            appliedAt: applied.appliedAt,
            version: request.version,
        };
    }
}
