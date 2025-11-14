"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.metricsMiddleware = metricsMiddleware;
const prometheus_1 = require("../metrics/prometheus");
function getRouteLabel(req) {
    const routePath = (req.route && req.route.path) || '';
    if (routePath) {
        return `${req.baseUrl || ''}${routePath}` || routePath;
    }
    const url = req.originalUrl || req.url || req.path;
    return url ? url.split('?')[0] : 'unknown';
}
function metricsMiddleware(req, res, next) {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
        const end = process.hrtime.bigint();
        const durationSeconds = Number(end - start) / 1_000_000_000;
        const method = req.method;
        const route = getRouteLabel(req);
        const statusCode = res.statusCode;
        (0, prometheus_1.observeHttpRequest)({
            method,
            route,
            statusCode,
            durationSeconds,
        });
    });
    next();
}
