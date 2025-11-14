"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.IdempotencyKeyConflictError = exports.MissingIdempotencyKeyError = void 0;
exports.setKernelCreateStore = setKernelCreateStore;
exports.resetKernelCreateStore = resetKernelCreateStore;
exports.getKernelCreateStore = getKernelCreateStore;
exports.handleKernelCreateRequest = handleKernelCreateRequest;
const crypto_1 = __importDefault(require("crypto"));
class MissingIdempotencyKeyError extends Error {
    constructor() {
        super('missing_idempotency_key');
        this.name = 'MissingIdempotencyKeyError';
    }
}
exports.MissingIdempotencyKeyError = MissingIdempotencyKeyError;
class IdempotencyKeyConflictError extends Error {
    constructor(message = 'idempotency_key_conflict') {
        super(message);
        this.name = 'IdempotencyKeyConflictError';
    }
}
exports.IdempotencyKeyConflictError = IdempotencyKeyConflictError;
function cloneResponse(resp) {
    const clone = {
        kernelId: resp.kernelId,
        createdAt: resp.createdAt,
        requestedBy: resp.requestedBy ?? null,
    };
    if (resp.name !== undefined) {
        clone.name = resp.name;
    }
    if (resp.metadata !== undefined) {
        clone.metadata = resp.metadata;
    }
    return clone;
}
class MemoryKernelCreateStore {
    records = new Map();
    async get(key) {
        const record = this.records.get(key);
        if (!record)
            return null;
        return {
            key: record.key,
            principalId: record.principalId,
            status: record.status,
            createdAt: record.createdAt,
            response: cloneResponse(record.response),
        };
    }
    async save(record) {
        const copy = {
            key: record.key,
            principalId: record.principalId,
            status: record.status,
            createdAt: record.createdAt,
            response: cloneResponse(record.response),
        };
        this.records.set(record.key, copy);
    }
}
let defaultStore = new MemoryKernelCreateStore();
function setKernelCreateStore(store) {
    defaultStore = store;
}
function resetKernelCreateStore() {
    defaultStore = new MemoryKernelCreateStore();
}
function getKernelCreateStore() {
    return defaultStore;
}
function normalizeIdempotencyKey(raw) {
    if (!raw || !raw.trim()) {
        throw new MissingIdempotencyKeyError();
    }
    return raw.trim();
}
async function handleKernelCreateRequest(input) {
    const { payload, principal, idempotencyKey, options } = input;
    const key = normalizeIdempotencyKey(idempotencyKey);
    const store = options?.store ?? getKernelCreateStore();
    const nowFn = options?.now ?? (() => new Date());
    const generateId = options?.idGenerator ?? (() => crypto_1.default.randomUUID());
    const existing = await store.get(key);
    if (existing) {
        if (existing.principalId && principal?.id && existing.principalId !== principal.id) {
            throw new IdempotencyKeyConflictError();
        }
        return {
            status: 200,
            response: cloneResponse(existing.response),
            idempotent: true,
            key,
        };
    }
    const createdAt = nowFn();
    const kernelId = payload?.kernelId || payload?.id || generateId();
    const response = {
        kernelId,
        createdAt: createdAt.toISOString(),
        requestedBy: principal?.id ?? null,
    };
    if (payload?.name !== undefined) {
        response.name = payload.name;
    }
    if (payload?.metadata !== undefined) {
        response.metadata = payload.metadata;
    }
    const record = {
        key,
        principalId: principal?.id ?? null,
        status: 201,
        createdAt: createdAt.toISOString(),
        response,
    };
    await store.save(record);
    return {
        status: 201,
        response: cloneResponse(response),
        idempotent: false,
        key,
    };
}
