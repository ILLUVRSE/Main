import { AsyncLocalStorage } from 'async_hooks';
import { Pool, PoolClient, PoolConfig, QueryResult } from 'pg';
import { JournalEntry, JournalLine } from '../models/journalEntry';
import { LedgerRepository, ProofManifestRecord } from './repository/ledgerRepository';
import { Payout } from '../models/payout';

type Queryable = Pick<Pool, 'query'> | PoolClient;

export interface PostgresLedgerRepositoryOptions {
  pool?: Pool;
  connectionString?: string;
  poolConfig?: PoolConfig;
}

export class PostgresLedgerRepository implements LedgerRepository {
  private readonly pool: Pool;
  private readonly tx = new AsyncLocalStorage<PoolClient>();

  constructor(options: PostgresLedgerRepositoryOptions | string = process.env.DATABASE_URL ?? '') {
    if (typeof options === 'string') {
      this.pool = new Pool({ connectionString: options });
    } else if (options.pool) {
      this.pool = options.pool;
    } else if (options.connectionString || options.poolConfig) {
      this.pool = new Pool({ connectionString: options.connectionString, ...options.poolConfig });
    } else {
      throw new Error('PostgresLedgerRepository requires connection details');
    }
  }

  async withTransaction<T>(fn: () => Promise<T>): Promise<T> {
    const existingClient = this.tx.getStore();
    if (existingClient) {
      return fn();
    }

    const client = await this.pool.connect();
    await client.query('BEGIN');
    try {
      const result = await this.tx.run(client, fn);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async insertJournalEntries(entries: JournalEntry[]): Promise<void> {
    for (const entry of entries) {
      await this.query(
        'INSERT INTO journal_entries (journal_id, batch_id, ts, currency, metadata) VALUES ($1, $2, $3, $4, $5)',
        [entry.journalId, entry.batchId, entry.timestamp, entry.currency, entry.metadata ?? {}]
      );
      if (entry.lines.length) {
        await this.insertLines(entry.journalId, entry.lines);
      }
    }
  }

  async recordPayout(payout: Payout): Promise<void> {
    await this.query(
      'INSERT INTO payouts (payout_id, invoice_id, amount_cents, currency, destination, memo, requested_by, status, provider_reference) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [
        payout.payoutId,
        payout.invoiceId ?? null,
        payout.amount,
        payout.currency,
        payout.destination,
        payout.memo ?? null,
        payout.requestedBy,
        payout.status,
        payout.providerReference ?? null,
      ]
    );
    if (payout.approvals?.length) {
      await this.insertApprovals(payout.payoutId, payout.approvals);
    }
  }

  async updatePayout(payoutId: string, patch: Partial<Payout>): Promise<void> {
    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;
    if (patch.invoiceId !== undefined) {
      fields.push(`invoice_id = $${idx++}`);
      values.push(patch.invoiceId);
    }
    if (patch.amount !== undefined) {
      fields.push(`amount_cents = $${idx++}`);
      values.push(patch.amount);
    }
    if (patch.currency !== undefined) {
      fields.push(`currency = $${idx++}`);
      values.push(patch.currency);
    }
    if (patch.destination !== undefined) {
      fields.push(`destination = $${idx++}`);
      values.push(patch.destination);
    }
    if (patch.memo !== undefined) {
      fields.push(`memo = $${idx++}`);
      values.push(patch.memo);
    }
    if (patch.requestedBy !== undefined) {
      fields.push(`requested_by = $${idx++}`);
      values.push(patch.requestedBy);
    }
    if (patch.status !== undefined) {
      fields.push(`status = $${idx++}`);
      values.push(patch.status);
    }
    if (patch.providerReference !== undefined) {
      fields.push(`provider_reference = $${idx++}`);
      values.push(patch.providerReference);
    }

    if (fields.length) {
      values.push(payoutId);
      await this.query(`UPDATE payouts SET ${fields.join(', ')} WHERE payout_id = $${idx}`, values);
    }

    if (patch.approvals) {
      await this.query('DELETE FROM payout_approvals WHERE payout_id = $1', [payoutId]);
      if (patch.approvals.length) {
        await this.insertApprovals(payoutId, patch.approvals);
      }
    }
  }

  async fetchLedgerRange(from: string, to: string): Promise<JournalEntry[]> {
    const entriesResult = await this.query<{
      journal_id: string;
      batch_id: string;
      ts: string;
      currency: string;
      metadata: Record<string, unknown> | null;
    }>(
      'SELECT journal_id, batch_id, ts, currency, metadata FROM journal_entries WHERE ts BETWEEN $1 AND $2 ORDER BY ts ASC',
      [from, to]
    );
    const ids = entriesResult.rows.map((row) => row.journal_id);
    if (!ids.length) return [];
    const linesResult = await this.query<{
      journal_id: string;
      account_id: string;
      direction: string;
      amount_cents: string;
      memo: string | null;
    }>(
      'SELECT journal_id, account_id, direction, amount_cents, memo FROM journal_lines WHERE journal_id = ANY($1::uuid[]) ORDER BY line_id ASC',
      [ids]
    );
    const grouped = new Map<string, JournalLine[]>();
    for (const row of linesResult.rows) {
      const list = grouped.get(row.journal_id) ?? [];
      list.push({
        accountId: row.account_id,
        direction: row.direction as JournalLine['direction'],
        amount: Number(row.amount_cents),
        memo: row.memo ?? undefined,
      });
      grouped.set(row.journal_id, list);
    }

    return entriesResult.rows.map((row) => ({
      journalId: row.journal_id,
      batchId: row.batch_id,
      timestamp: row.ts,
      currency: row.currency,
      metadata: row.metadata ?? undefined,
      lines: grouped.get(row.journal_id) ?? [],
    }));
  }

  async getPayout(payoutId: string): Promise<Payout | undefined> {
    const payoutResult = await this.query<{
      payout_id: string;
      invoice_id: string | null;
      amount_cents: string;
      currency: string;
      destination: any;
      memo: string | null;
      requested_by: string;
      status: string;
      created_at: string;
      provider_reference: string | null;
    }>('SELECT * FROM payouts WHERE payout_id = $1', [payoutId]);
    if (!payoutResult.rowCount) return undefined;
    const row = payoutResult.rows[0];
    const approvalsResult = await this.query<{
      approver: string;
      role: string;
      signature: string;
      comment: string | null;
      approved_at: string;
    }>('SELECT approver, role, signature, comment, approved_at FROM payout_approvals WHERE payout_id = $1 ORDER BY approved_at ASC', [payoutId]);
    return {
      payoutId: row.payout_id,
      invoiceId: row.invoice_id ?? undefined,
      amount: Number(row.amount_cents),
      currency: row.currency,
      destination: row.destination,
      memo: row.memo ?? undefined,
      requestedBy: row.requested_by,
      status: row.status as Payout['status'],
      providerReference: row.provider_reference ?? undefined,
      approvals: approvalsResult.rows.map((approval) => ({
        approver: approval.approver,
        role: approval.role,
        signature: approval.signature,
        comment: approval.comment ?? undefined,
        approvedAt: approval.approved_at,
      })),
    };
  }

  async recordProofManifest(manifest: ProofManifestRecord): Promise<void> {
    await this.query(
      'INSERT INTO proof_manifest (proof_id, range_from, range_to, manifest, manifest_hash, root_hash, s3_object_key) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [
        manifest.proofId,
        manifest.rangeFrom,
        manifest.rangeTo,
        manifest.manifest,
        manifest.manifestHash,
        manifest.rootHash,
        manifest.s3ObjectKey ?? null,
      ]
    );
  }

  async getProofManifest(proofId: string): Promise<ProofManifestRecord | undefined> {
    const result = await this.query<{
      proof_id: string;
      range_from: string;
      range_to: string;
      manifest: Record<string, unknown>;
      manifest_hash: string;
      root_hash: string;
      s3_object_key: string | null;
    }>('SELECT proof_id, range_from, range_to, manifest, manifest_hash, root_hash, s3_object_key FROM proof_manifest WHERE proof_id = $1', [proofId]);
    if (!result.rowCount) return undefined;
    const row = result.rows[0];
    return {
      proofId: row.proof_id,
      rangeFrom: row.range_from,
      rangeTo: row.range_to,
      manifest: row.manifest,
      manifestHash: row.manifest_hash,
      rootHash: row.root_hash,
      s3ObjectKey: row.s3_object_key ?? undefined,
    };
  }

  private async insertLines(journalId: string, lines: JournalLine[]): Promise<void> {
    const values: any[] = [];
    const placeholders = lines.map((line, idx) => {
      const base = idx * 5;
      values.push(journalId, line.accountId, line.direction, line.amount, line.memo ?? null);
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`;
    });
    await this.query(
      `INSERT INTO journal_lines (journal_id, account_id, direction, amount_cents, memo) VALUES ${placeholders.join(',')}`,
      values
    );
  }

  private async insertApprovals(payoutId: string, approvals: Payout['approvals']): Promise<void> {
    const values: any[] = [];
    const placeholders = approvals.map((approval, idx) => {
      const base = idx * 6;
      values.push(payoutId, approval.approver, approval.role, approval.signature, approval.comment ?? null, approval.approvedAt);
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`;
    });
    await this.query(
      `INSERT INTO payout_approvals (payout_id, approver, role, signature, comment, approved_at) VALUES ${placeholders.join(',')}`,
      values
    );
  }

  private async query<T = any>(sql: string, params: any[] = []): Promise<QueryResult<T>> {
    const executor: Queryable = this.tx.getStore() ?? this.pool;
    return executor.query<T>(sql, params);
  }
}
