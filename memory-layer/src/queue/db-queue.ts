
import { IQueue, IQueueItem } from './interfaces';
import { Pool } from 'pg';

export class DbQueue implements IQueue {
  private pool: Pool;
  private tableName: string = 'embedding_queue';
  private useSkipLocked: boolean = true;

  constructor(pool: Pool, useSkipLocked: boolean = true) {
    this.pool = pool;
    this.useSkipLocked = useSkipLocked;
  }

  async init(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${this.tableName} (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        metadata JSONB,
        attempts INT DEFAULT 0,
        next_retry TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        status TEXT DEFAULT 'pending', -- pending, processing, dead_letter
        dead_letter_reason TEXT
      );
    `);
  }

  async enqueue(item: Omit<IQueueItem, 'attempts'>): Promise<void> {
    await this.pool.query(
      `INSERT INTO ${this.tableName} (id, content, metadata, next_retry, status)
       VALUES ($1, $2, $3, NOW(), 'pending')
       ON CONFLICT (id) DO UPDATE SET
         content = EXCLUDED.content,
         metadata = EXCLUDED.metadata,
         status = 'pending',
         next_retry = NOW()
       `,
      [item.id, item.content, JSON.stringify(item.metadata)]
    );
  }

  async dequeue(): Promise<IQueueItem | null> {
    // Basic implementation: find first pending item where next_retry <= NOW()
    // Using simple locking with FOR UPDATE SKIP LOCKED if possible, or just update returning
    // Postgres supports UPDATE ... RETURNING

    // We update status to 'processing' so other workers don't pick it up
    const skipLocked = this.useSkipLocked ? 'FOR UPDATE SKIP LOCKED' : 'FOR UPDATE';

    // Debug logging for troubleshooting pg-mem
    const pendingCount = await this.pool.query(`SELECT count(*) as c FROM ${this.tableName} WHERE status = 'pending'`);
    // console.log('Pending items:', pendingCount.rows[0].c);

    const res = await this.pool.query(
      `UPDATE ${this.tableName}
       SET status = 'processing', attempts = attempts + 1
       WHERE id = (
         SELECT id
         FROM ${this.tableName}
         WHERE status = 'pending' AND next_retry <= NOW()
         ORDER BY next_retry ASC
         LIMIT 1
         ${skipLocked}
       )
       RETURNING id, content, metadata, attempts, next_retry`
    );

    // console.log('Dequeue result:', res.rows.length);

    if (res.rows.length === 0) return null;

    const row = res.rows[0];
    return {
      id: row.id,
      content: row.content,
      metadata: row.metadata,
      attempts: row.attempts,
      nextRetry: row.next_retry
    };
  }

  async ack(id: string): Promise<void> {
    await this.pool.query(`DELETE FROM ${this.tableName} WHERE id = $1`, [id]);
  }

  async nack(id: string, nextRetry: Date): Promise<void> {
    await this.pool.query(
      `UPDATE ${this.tableName} SET status = 'pending', next_retry = $2 WHERE id = $1`,
      [id, nextRetry]
    );
  }

  async deadLetter(id: string, reason: string): Promise<void> {
    await this.pool.query(
      `UPDATE ${this.tableName} SET status = 'dead_letter', dead_letter_reason = $2 WHERE id = $1`,
      [id, reason]
    );
  }
}
