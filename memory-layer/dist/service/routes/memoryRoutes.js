"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.memoryRoutes = void 0;
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const piiRedaction_1 = require("../middleware/piiRedaction");
/**
 * Small async wrapper to avoid repeating try/catch in every route.
 */
const asyncHandler = (fn) => {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
};
/**
 * Build audit context from headers.
 * Accepts:
 *  - X-Manifest-Signature-Id
 *  - X-Prev-Audit-Hash
 *  - X-Service-Id (caller)
 */
const buildAuditContext = (req) => ({
    manifestSignatureId: (req.header('x-manifest-signature-id') ?? undefined),
    prevAuditHash: (req.header('x-prev-audit-hash') ?? undefined),
    caller: (req.header('x-service-id') ?? req.header('x-service') ?? 'unknown')
});
const memoryRoutes = (memoryService) => {
    const router = (0, express_1.Router)();
    router.post('/memory/nodes', (0, auth_1.requireScopes)(auth_1.MemoryScopes.WRITE), asyncHandler(async (req, res) => {
        const payload = req.body;
        // If artifacts are present and some lack manifestSignatureId, allow a global x-manifest-signature-id header
        const ctx = buildAuditContext(req);
        if (payload.artifacts && payload.artifacts.some((a) => !a.manifestSignatureId)) {
            if (!ctx.manifestSignatureId) {
                res.status(400).json({
                    error: {
                        message: 'artifact entries missing manifestSignatureId; provide per-artifact manifestSignatureId or X-Manifest-Signature-Id header'
                    }
                });
                return;
            }
            // apply header manifestSignatureId as default for artifacts lacking it
            payload.artifacts = payload.artifacts.map((a) => ({
                ...a,
                manifestSignatureId: a.manifestSignatureId ?? ctx.manifestSignatureId
            }));
        }
        const result = await memoryService.createMemoryNode(payload, ctx);
        res.status(201).json(result);
    }));
    router.get('/memory/nodes/:id', (0, auth_1.requireScopes)(auth_1.MemoryScopes.READ), piiRedaction_1.piiRedactionMiddleware, asyncHandler(async (req, res) => {
        const node = await memoryService.getMemoryNode(req.params.id);
        if (!node) {
            res.status(404).json({ error: { message: 'memory node not found' } });
            return;
        }
        res.json(node);
    }));
    router.post('/memory/artifacts', (0, auth_1.requireScopes)(auth_1.MemoryScopes.WRITE), asyncHandler(async (req, res) => {
        const payload = req.body;
        const ctx = buildAuditContext(req);
        // If artifact payload does not include manifestSignatureId, try header fallback
        if (!payload.manifestSignatureId) {
            if (ctx.manifestSignatureId) {
                payload.manifestSignatureId = ctx.manifestSignatureId;
            }
            else {
                res.status(400).json({
                    error: { message: 'manifestSignatureId is required for artifact writes (body.manifestSignatureId or X-Manifest-Signature-Id)' }
                });
                return;
            }
        }
        const result = await memoryService.createArtifact(payload.memoryNodeId ?? null, payload, ctx);
        res.status(201).json(result);
    }));
    router.post('/memory/search', (0, auth_1.requireScopes)(auth_1.MemoryScopes.READ), asyncHandler(async (req, res) => {
        const payload = req.body;
        const results = await memoryService.searchMemoryNodes(payload);
        res.json({ results });
    }));
    router.post('/memory/nodes/:id/legal-hold', (0, auth_1.requireScopes)({ anyOf: [auth_1.MemoryScopes.LEGAL_HOLD, auth_1.MemoryScopes.ADMIN] }), asyncHandler(async (req, res) => {
        const { legalHold, reason } = req.body;
        if (typeof legalHold !== 'boolean') {
            res.status(400).json({ error: { message: 'legalHold boolean is required' } });
            return;
        }
        const ctx = buildAuditContext(req);
        await memoryService.setLegalHold(req.params.id, legalHold, reason, ctx);
        res.status(204).send();
    }));
    router.delete('/memory/nodes/:id', (0, auth_1.requireScopes)({ anyOf: [auth_1.MemoryScopes.ADMIN, auth_1.MemoryScopes.WRITE] }), asyncHandler(async (req, res) => {
        const ctx = buildAuditContext(req);
        await memoryService.deleteMemoryNode(req.params.id, ctx.caller ?? 'unknown', ctx);
        res.status(204).send();
    }));
    router.get('/memory/artifacts/:id', (0, auth_1.requireScopes)(auth_1.MemoryScopes.READ), asyncHandler(async (req, res) => {
        const artifact = await memoryService.getArtifact(req.params.id);
        if (!artifact) {
            res.status(404).json({ error: { message: 'artifact not found' } });
            return;
        }
        res.json(artifact);
    }));
    return router;
};
exports.memoryRoutes = memoryRoutes;
exports.default = exports.memoryRoutes;
