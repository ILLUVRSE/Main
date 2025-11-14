"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = createAdminRouter;
const express_1 = __importDefault(require("express"));
const db_1 = require("../db");
const config_1 = require("../idempotency/config");
const rbac_1 = require("../rbac");
const auditPolicy_1 = require("../audit/auditPolicy");
function parseLimit(raw) {
    if (typeof raw === 'string' && raw.trim()) {
        const parsed = Number(raw);
        if (Number.isFinite(parsed) && parsed > 0) {
            return Math.min(Math.floor(parsed), 500);
        }
    }
    return 100;
}
function createAdminRouter() {
    const router = express_1.default.Router();
    router.get('/admin/idempotency', (0, rbac_1.requireRoles)(rbac_1.Roles.SUPERADMIN), async (req, res, next) => {
        try {
            const limit = parseLimit(req.query.limit);
            const tableName = (0, config_1.getIdempotencyTableName)();
            const sql = `SELECT key, method, path, request_hash, response_status, created_at, expires_at
          FROM ${tableName}
          ORDER BY created_at DESC
          LIMIT $1`;
            const result = await (0, db_1.query)(sql, [limit]);
            const records = result.rows.map((row) => ({
                key: row.key,
                method: row.method,
                path: row.path,
                requestHash: row.request_hash,
                responseStatus: row.response_status != null ? Number(row.response_status) : null,
                createdAt: row.created_at,
                expiresAt: row.expires_at,
            }));
            res.json({ keys: records });
        }
        catch (err) {
            next(err);
        }
    });
    router.post('/admin/audit/cleanup', (0, rbac_1.requireRoles)(rbac_1.Roles.SUPERADMIN), async (_req, res, next) => {
        try {
            const removed = await (0, auditPolicy_1.cleanupExpiredAuditEvents)();
            res.json({ removed });
        }
        catch (err) {
            next(err);
        }
    });
    return router;
}
