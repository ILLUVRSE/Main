/**
 * kernel/src/services/multisig.ts
 *
 * Implements the multisig upgrade flow logic.
 */

import { query, getClient } from '../db';
import { appendAuditEvent } from '../auditStore';
import crypto from 'crypto';
import { PoolClient } from 'pg';

export interface MultisigProposal {
  id: string;
  proposal_id: string;
  proposer_id: string;
  payload: any;
  required_threshold: number;
  signer_set: string[];
  status: 'proposed' | 'approved' | 'applied' | 'rejected' | 'ratified';
  created_at: string;
  updated_at: string;
  applied_at?: string;
  expires_at?: string;
  approvals?: MultisigApproval[];
}

export interface MultisigApproval {
  id: string;
  proposal_id: string;
  signer_id: string;
  signature: string;
  created_at: string;
  revoked_at?: string;
}

export interface MultisigSigner {
  id: string;
  signer_id: string;
  public_key: string;
  role: string;
}

export class MultisigService {
  /**
   * Register or update a signer
   */
  async registerSigner(signerId: string, publicKey: string, role: string = 'signer'): Promise<MultisigSigner> {
    const client = await getClient();
    try {
      const id = crypto.randomUUID();
      const insertSql = `
        INSERT INTO multisig_signers (id, signer_id, public_key, role, created_at, updated_at)
        VALUES ($1, $2, $3, $4, now(), now())
        ON CONFLICT (signer_id) DO UPDATE SET public_key = EXCLUDED.public_key, updated_at = now()
        RETURNING *
      `;
      const res = await client.query(insertSql, [id, signerId, publicKey, role]);
      return res.rows[0] as unknown as MultisigSigner;
    } finally {
      client.release();
    }
  }

  /**
   * Create a new multisig proposal
   */
  async createProposal(
    proposalId: string,
    proposerId: string,
    payload: any,
    signerSet: string[],
    threshold: number = 3
  ): Promise<MultisigProposal> {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      const id = crypto.randomUUID();
      const insertSql = `
        INSERT INTO multisig_proposals (id, proposal_id, proposer_id, payload, required_threshold, signer_set, status, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, 'proposed', now(), now())
        RETURNING *
      `;
      const res = await client.query(insertSql, [
        id, proposalId, proposerId, payload, threshold, JSON.stringify(signerSet)
      ]);

      await appendAuditEvent('multisig.proposal.created', {
        proposalId: id,
        externalId: proposalId,
        proposerId,
        payload,
        signerSet,
        threshold
      });

      await client.query('COMMIT');
      return res.rows[0] as unknown as MultisigProposal;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Add an approval to a proposal
   */
  async approveProposal(
    proposalId: string,
    signerId: string,
    signature: string
  ): Promise<MultisigApproval> {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      // Check if proposal exists and is active
      const propRes = await client.query(
        'SELECT * FROM multisig_proposals WHERE id = $1',
        [proposalId]
      );
      if (!propRes.rows.length) throw new Error('Proposal not found');
      const proposal = propRes.rows[0];

      if (proposal.status === 'applied' || proposal.status === 'rejected') {
        throw new Error(`Proposal is already ${proposal.status}`);
      }

      // Verify signer is in signer_set
      const signers = proposal.signer_set;
      if (!signers.includes(signerId)) {
        throw new Error('Signer not authorized for this proposal');
      }

      // Fetch signer public key for verification
      const signerRes = await client.query('SELECT * FROM multisig_signers WHERE signer_id = $1', [signerId]);
      if (!signerRes.rows.length) {
         // Fallback: if in signer_set but not in registry, we might block or allow depending on policy.
         // Requirement: "Verify signer identity/signature".
         // If we don't have public key, we can't verify signature.
         throw new Error('Signer not registered (public key missing)');
      }
      const signer = signerRes.rows[0];

      if (signer.public_key) {
        try {
          const verify = crypto.createVerify('SHA256');
          verify.update(proposalId);
          verify.end();
          const isValid = verify.verify(signer.public_key, signature, 'base64');
          if (!isValid) throw new Error('Signature verification failed');
        } catch (e) {
          throw new Error('Signature verification failed: ' + (e as Error).message);
        }
      }

      // Add approval
      const approvalId = crypto.randomUUID();
      const insertSql = `
        INSERT INTO multisig_approvals (id, proposal_id, signer_id, signature, created_at)
        VALUES ($1, $2, $3, $4, now())
        RETURNING *
      `;
      const appRes = await client.query(insertSql, [approvalId, proposalId, signerId, signature]);

      // Check if threshold reached
      const countRes = await client.query(
        `SELECT COUNT(*) as count FROM multisig_approvals
         WHERE proposal_id = $1 AND revoked_at IS NULL`,
        [proposalId]
      );
      const count = parseInt(countRes.rows[0].count);

      if (count >= proposal.required_threshold && proposal.status === 'proposed') {
        await client.query(
          `UPDATE multisig_proposals SET status = 'approved', updated_at = now() WHERE id = $1`,
          [proposalId]
        );
      }

      await appendAuditEvent('multisig.proposal.approved', {
        proposalId,
        signerId,
        signature
      });

      await client.query('COMMIT');
      return appRes.rows[0] as unknown as MultisigApproval;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Revoke an approval
   */
  async revokeApproval(proposalId: string, signerId: string): Promise<void> {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      const res = await client.query(
        `UPDATE multisig_approvals SET revoked_at = now()
         WHERE proposal_id = $1 AND signer_id = $2 AND revoked_at IS NULL
         RETURNING id`,
        [proposalId, signerId]
      );

      if (!res.rowCount) {
        throw new Error('Approval not found or already revoked');
      }

      // Check if status needs to revert to proposed
       const propRes = await client.query(
        'SELECT * FROM multisig_proposals WHERE id = $1',
        [proposalId]
      );
      const proposal = propRes.rows[0];

      if (proposal.status === 'applied') {
        throw new Error('Cannot revoke approval for applied proposal');
      }

      const countRes = await client.query(
        `SELECT COUNT(*) as count FROM multisig_approvals
         WHERE proposal_id = $1 AND revoked_at IS NULL`,
        [proposalId]
      );
      const count = parseInt(countRes.rows[0].count);

      if (count < proposal.required_threshold && proposal.status === 'approved') {
        await client.query(
          `UPDATE multisig_proposals SET status = 'proposed', updated_at = now() WHERE id = $1`,
          [proposalId]
        );
      }

      await appendAuditEvent('multisig.proposal.revoked', {
        proposalId,
        signerId
      });

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Apply the proposal (if threshold met)
   */
  async applyProposal(proposalId: string, applierId: string): Promise<void> {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      const propRes = await client.query(
        'SELECT * FROM multisig_proposals WHERE id = $1 FOR UPDATE',
        [proposalId]
      );
      if (!propRes.rows.length) throw new Error('Proposal not found');
      const proposal = propRes.rows[0];

      if (proposal.status === 'applied') {
        await client.query('ROLLBACK');
        return; // Idempotent
      }

      if (proposal.status !== 'approved') {
        // Double check count inside transaction just in case
        const countRes = await client.query(
            `SELECT COUNT(*) as count FROM multisig_approvals
             WHERE proposal_id = $1 AND revoked_at IS NULL`,
            [proposalId]
        );
        const count = parseInt(countRes.rows[0].count);
        if (count < proposal.required_threshold) {
             throw new Error(`Insufficient approvals: ${count}/${proposal.required_threshold}`);
        }
      }

      // APPLY LOGIC HERE
      // For now we just mark it as applied, but in a real system we would execute the payload.
      // The task says "payload (upgrade plan)". We assume the payload is data-driven or handled elsewhere.
      // Ideally, we might dispatch based on payload type.

      await client.query(
        `UPDATE multisig_proposals SET status = 'applied', applied_at = now(), updated_at = now() WHERE id = $1`,
        [proposalId]
      );

      await appendAuditEvent('multisig.proposal.applied', {
        proposalId,
        applierId,
        payload: proposal.payload
      });

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Emergency Ratify
   */
  async ratifyProposal(proposalId: string, ratifierId: string, reason: string): Promise<void> {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      const propRes = await client.query(
        'SELECT * FROM multisig_proposals WHERE id = $1 FOR UPDATE',
        [proposalId]
      );
      if (!propRes.rows.length) throw new Error('Proposal not found');
      const proposal = propRes.rows[0];

      if (proposal.status === 'applied') {
        // Already applied, maybe we are ratifying retroactively?
        // But let's assume we can also ratify to force apply.
      }

      await client.query(
        `UPDATE multisig_proposals SET status = 'ratified', applied_at = COALESCE(applied_at, now()), updated_at = now() WHERE id = $1`,
        [proposalId]
      );

      await appendAuditEvent('multisig.proposal.ratified', {
        proposalId,
        ratifierId,
        reason
      });

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async getProposal(id: string): Promise<MultisigProposal | null> {
    const res = await query('SELECT * FROM multisig_proposals WHERE id = $1', [id]);
    if (!res.rows.length) return null;
    const proposal = res.rows[0] as unknown as MultisigProposal;

    const approvRes = await query(
        'SELECT * FROM multisig_approvals WHERE proposal_id = $1 AND revoked_at IS NULL',
        [id]
    );
    proposal.approvals = approvRes.rows as unknown as MultisigApproval[];
    return proposal;
  }
}

export const multisigService = new MultisigService();
