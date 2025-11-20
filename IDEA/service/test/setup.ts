import { afterAll } from 'vitest';
import { pool } from '../src/db';

process.env.NODE_ENV = 'test';
process.env.IDEA_DATABASE_URL = process.env.IDEA_DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5432/idea_test';
process.env.AUTH_JWT_SECRET = process.env.AUTH_JWT_SECRET || 'test-secret';
delete process.env.SIGNING_PROXY_URL;
process.env.DEV_PACKAGE_DIR = process.env.DEV_PACKAGE_DIR || `${process.cwd()}/tmp/dev-packages`;
process.env.IDEA_S3_BUCKET = 'idea-packages';
process.env.KERNEL_API_URL = process.env.KERNEL_API_URL || 'http://127.0.0.1:7111';
process.env.USE_PGMEM = '1';

afterAll(async () => {
  await pool.end();
});
