"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createKernelRouter = createKernelRouter;
const crypto_1 = __importDefault(require("crypto"));
const express_1 = require("express");
const db_1 = require("../../db");
const auth_1 = require("../../middleware/auth");
const rbac_1 = require("../../middleware/rbac");
const logger_1 = require("../../logger");
class PgIdempotencyStore {
    ensured = false;
    async ensureTable() {
        if (this.ensured)
            return;
        await (0, db_1.query)(`
      CREATE TABLE IF NOT EXISTS idempotency (
        key TEXT PRIMARY KEY,
        method TEXT NOT NULL,
        path TEXT NOT NULL,
        status INTEGER NOT NULL,
        response JSONB NOT NULL,
        principal_id TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
        this.ensured = true;
    }
    async get(key) {
        await this.ensureTable();
        const res = await (0, db_1.query)('SELECT key, method, path, status, response, principal_id, created_at FROM idempotency WHERE key = $1 LIMIT 1', [key]);
        if (!res.rows.length)
            return null;
        const row = res.rows[0];
        const responseValue = typeof row.response === 'string' ? JSON.parse(row.response) : row.response;
        return {
            key: String(row.key),
            method: String(row.method),
            path: String(row.path),
            status: Number(row.status),
            response: responseValue,
            principalId: row.principal_id ? String(row.principal_id) : undefined,
            createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
        };
    }
    async save(record) {
        await this.ensureTable();
        await (0, db_1.query)(`INSERT INTO idempotency (key, method, path, status, response, principal_id, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (key) DO UPDATE SET
         status = EXCLUDED.status,
         response = EXCLUDED.response,
         principal_id = EXCLUDED.principal_id,
         created_at = EXCLUDED.created_at`, [
            record.key,
            record.method,
            record.path,
            record.status,
            JSON.stringify(record.response ?? {}),
            record.principalId ?? null,
            record.createdAt,
        ]);
    }
}
const DEFAULT_STATUS = 200;
async function defaultCreateKernel(payload, principal) {
    const kernelId = payload?.kernelId || payload?.id || crypto_1.default.randomUUID();
    return {
        kernelId,
        status: 'created',
        requestedBy: principal.id,
        metadata: payload?.metadata ?? null,
        createdAt: new Date().toISOString(),
    };
}
function validateIdempotencyKey(req) {
    const key = req.header('Idempotency-Key');
    if (!key || !key.trim()) {
        throw new Error('missing idempotency key');
    }
    return key.trim();
}
async function handleKernelCreate(req, res, next, opts) {
    try {
        const key = validateIdempotencyKey(req);
        const store = opts.idempotencyStore ?? new PgIdempotencyStore();
        const principal = req.principal;
        if (!principal) {
            return res.status(401).json({ error: 'unauthenticated' });
        }
        const existing = await store.get(key);
        if (existing) {
            res.setHeader('Idempotency-Key', key);
            logger_1.logger.info('kernel.create.idempotent_hit', { key, principal: principal.id, path: req.path });
            return res.status(existing.status).json(existing.response);
        }
        const factory = opts.createKernel ?? defaultCreateKernel;
        const result = await factory(req.body ?? {}, principal);
        const record = {
            key,
            method: req.method,
            path: req.path,
            status: DEFAULT_STATUS,
            response: result,
            principalId: principal.id,
            createdAt: new Date().toISOString(),
        };
        await store.save(record);
        res.setHeader('Idempotency-Key', key);
        logger_1.logger.audit('kernel.create', { key, principal: principal.id, kernelId: result.kernelId });
        return res.status(DEFAULT_STATUS).json(result);
    }
    catch (err) {
        if (err.message === 'missing idempotency key') {
            return res.status(400).json({ error: 'missing_idempotency_key' });
        }
        return next(err);
    }
}
function createKernelRouter(options = {}) {
    const router = (0, express_1.Router)();
    router.use(auth_1.authMiddleware);
    router.post('/kernel/create', (0, rbac_1.requireRoles)(rbac_1.Roles.SUPERADMIN, rbac_1.Roles.OPERATOR), (req, res, next) => handleKernelCreate(req, res, next, options));
    return router;
}
exports.default = createKernelRouter;
