// gitSafety.ts
// Helper wrappers around simple-git to ensure commits are authored correctly
// and to provide a conservative surface for any git interaction the service needs.

import { recordAuditEvent } from './auditService';

export const approveCommit = async (commitDetails) => {
    // Logic to interact with ControlPanel multisig flow
    const approval = await controlPanel.approve(commitDetails);
    await recordAuditEvent({ type: 'commitApproval', details: approval });
};

export const signManifest = async (manifest) => {
    // Logic to sign the manifest before committing
    const signedManifest = await kernel.sign(manifest);
    return signedManifest;
};

// Other existing functions remain unchanged.
