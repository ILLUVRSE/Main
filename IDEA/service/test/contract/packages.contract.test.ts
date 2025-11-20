import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { buildApp } from '../../src/index';
import { pool, runMigrations } from '../../src/db';

const DEV_DIR = process.env.DEV_PACKAGE_DIR!;

describe('IDEA packages contract', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    await runMigrations();
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    const tables = ['idea_publish_events', 'idea_manifest_approvals', 'idea_manifests', 'idea_packages', 'audit_events'];
    for (const table of tables) {
      await pool.query(`DELETE FROM ${table}`);
    }
    mkdirSync(DEV_DIR, { recursive: true });
  });

  test('submit + complete contract', async () => {
    const submitRes = await app.inject({
      method: 'POST',
      url: '/packages/submit',
      headers: { 'x-actor-id': 'contract-tester' },
      payload: {
        package_name: 'gameplay-overhaul',
        version: '1.2.3',
        metadata: { component: 'ai' }
      }
    });
    expect(submitRes.statusCode).toBe(200);
    const submitBody = submitRes.json();
    expect(submitBody.package.id).toMatch(/[0-9a-f-]{36}/);

    const objectKey: string = submitBody.upload.bucket_key;
    const filePath = path.join(DEV_DIR, objectKey);
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, Buffer.from('demo-artifact'));

    const completeRes = await app.inject({
      method: 'POST',
      url: `/packages/${submitBody.package.id}/complete`,
      headers: { 'x-actor-id': 'contract-tester' },
      payload: {
        s3_key: objectKey
      }
    });
    expect(completeRes.statusCode).toBe(200);
    const completeBody = completeRes.json();
    expect(completeBody.package_id).toBe(submitBody.package.id);
    expect(completeBody.sha256).toHaveLength(64);
  });
});
