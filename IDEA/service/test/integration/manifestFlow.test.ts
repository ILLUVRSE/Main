import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { buildApp } from '../../src/index';
import { pool, runMigrations } from '../../src/db';

describe('manifest signing + multisig flow', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let originalFetch: typeof fetch;

  beforeAll(async () => {
    await runMigrations();
    originalFetch = global.fetch;
    global.fetch = (async (input: any, init?: any) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/manifests/sign')) {
        const body = init?.body ? JSON.parse(init.body as string) : {};
        return new Response(
          JSON.stringify({
            manifest_signature_id: `sig-${body.manifest_id}`,
            signature: 'base64signature',
            signer_kid: 'kernel-mock',
            payload: body.payload
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      return originalFetch(input as any, init);
    }) as typeof fetch;
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
    global.fetch = originalFetch;
  });

  beforeEach(async () => {
    const tables = ['idea_publish_events', 'idea_manifest_approvals', 'idea_manifests', 'idea_packages', 'audit_events'];
    for (const table of tables) {
      await pool.query(`DELETE FROM ${table}`);
    }
  });

  test('happy path flow', async () => {
    const devDir = process.env.DEV_PACKAGE_DIR!;
    mkdirSync(devDir, { recursive: true });

    const submit = await app.inject({
      method: 'POST',
      url: '/packages/submit',
      headers: { 'x-actor-id': 'tester' },
      payload: {
        package_name: 'balance-update',
        version: '2.0.0',
        metadata: { impact: 'HIGH' }
      }
    });
    const pkg = submit.json().package;
    const objectKey = submit.json().upload.bucket_key;
    const filePath = path.join(devDir, objectKey);
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, Buffer.from('artifact-data'));

    await app.inject({
      method: 'POST',
      url: `/packages/${pkg.id}/complete`,
      headers: { 'x-actor-id': 'tester' },
      payload: { s3_key: objectKey }
    });

    const manifestCreate = await app.inject({
      method: 'POST',
      url: '/manifests/create',
      headers: { 'x-actor-id': 'tester' },
      payload: {
        package_id: pkg.id,
        impact: 'HIGH',
        preconditions: { requires: 'sentinel-net-pass' }
      }
    });
    const manifestId = manifestCreate.json().manifest_id;

    const signRes = await app.inject({
      method: 'POST',
      url: `/manifests/${manifestId}/submit-for-signing`,
      headers: { 'x-actor-id': 'tester' },
      payload: {}
    });
    expect(signRes.statusCode).toBe(200);

    await app.inject({
      method: 'POST',
      url: `/manifests/${manifestId}/request-multisig`,
      headers: { 'x-actor-id': 'tester' },
      payload: {
        approvals_required: 2,
        approvers: ['alice', 'bob', 'carol']
      }
    });

    await app.inject({
      method: 'POST',
      url: `/manifests/${manifestId}/approvals`,
      headers: { 'x-actor-id': 'alice' },
      payload: { approver_id: 'alice', decision: 'approved' }
    });
    const approve2 = await app.inject({
      method: 'POST',
      url: `/manifests/${manifestId}/approvals`,
      headers: { 'x-actor-id': 'bob' },
      payload: { approver_id: 'bob', decision: 'approved' }
    });
    expect(approve2.json().status).toBe('multisig_complete');

    const apply = await app.inject({
      method: 'POST',
      url: `/manifests/${manifestId}/apply`,
      headers: { 'x-actor-id': 'tester' }
    });
    expect(apply.statusCode).toBe(200);
    expect(apply.json().status).toBe('applied');
  });
});
