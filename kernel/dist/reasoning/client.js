"use strict";
/**
 * kernel/src/reasoning/client.ts
 *
 * Minimal client for the reasoning-graph service. Responsible for fetching
 * reasoning traces, applying Sentinel-style PII redaction rules, and exposing
 * a configurable singleton used by the HTTP routes.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReasoningClient = exports.ReasoningClientError = void 0;
exports.getReasoningClient = getReasoningClient;
exports.setReasoningClient = setReasoningClient;
const node_fetch_1 = __importDefault(require("node-fetch"));
class ReasoningClientError extends Error {
    status;
    constructor(message, status) {
        super(message);
        this.status = status;
        this.name = 'ReasoningClientError';
    }
}
exports.ReasoningClientError = ReasoningClientError;
const REDACTION_PATTERNS = [
    { pattern: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, replacement: '[REDACTED EMAIL]' },
    { pattern: /\b\d{3}-\d{2}-\d{4}\b/g, replacement: '[REDACTED SSN]' },
    { pattern: /\b(?:\d[ -]?){13,16}\b/g, replacement: '[REDACTED CARD]' },
    { pattern: /\b\d{3}-\d{3}-\d{4}\b/g, replacement: '[REDACTED PHONE]' },
];
function redactString(value) {
    return REDACTION_PATTERNS.reduce((acc, rule) => acc.replace(rule.pattern, rule.replacement), value);
}
function deepCloneRedact(value) {
    if (value === null || value === undefined) {
        return value;
    }
    if (typeof value === 'string') {
        return redactString(value);
    }
    if (Array.isArray(value)) {
        return value.map((entry) => deepCloneRedact(entry));
    }
    if (typeof value === 'object') {
        const out = {};
        for (const key of Object.keys(value)) {
            out[key] = deepCloneRedact(value[key]);
        }
        return out;
    }
    return value;
}
class ReasoningClient {
    baseUrl;
    apiKey;
    constructor(baseUrl, apiKey) {
        this.baseUrl = baseUrl;
        this.apiKey = apiKey;
        this.baseUrl = baseUrl.replace(/\/$/, '');
    }
    headers() {
        const headers = { 'Content-Type': 'application/json' };
        if (this.apiKey) {
            headers.Authorization = `Bearer ${this.apiKey}`;
        }
        return headers;
    }
    async fetchTrace(nodeId) {
        const url = `${this.baseUrl}/reason/${encodeURIComponent(nodeId)}`;
        const res = await (0, node_fetch_1.default)(url, { headers: this.headers() });
        if (res.status === 404) {
            throw new ReasoningClientError('trace_not_found', 404);
        }
        if (!res.ok) {
            const text = await res.text();
            throw new ReasoningClientError(text || `reasoning service error (${res.status})`, res.status);
        }
        const payload = (await res.json());
        if (!payload || typeof payload !== 'object') {
            throw new ReasoningClientError('invalid_response', 502);
        }
        return payload;
    }
    redactTrace(trace) {
        return {
            node: trace.node,
            metadata: trace.metadata ? deepCloneRedact(trace.metadata) : undefined,
            trace: Array.isArray(trace.trace)
                ? trace.trace.map((entry) => deepCloneRedact(entry))
                : [],
        };
    }
    async getRedactedTrace(nodeId) {
        const raw = await this.fetchTrace(nodeId);
        return this.redactTrace(raw);
    }
}
exports.ReasoningClient = ReasoningClient;
let sharedClient = null;
function getReasoningClient() {
    if (!sharedClient) {
        const baseUrl = process.env.REASONING_GRAPH_URL || 'http://127.0.0.1:7600';
        sharedClient = new ReasoningClient(baseUrl, process.env.REASONING_GRAPH_API_KEY);
    }
    return sharedClient;
}
function setReasoningClient(client) {
    sharedClient = client;
}
