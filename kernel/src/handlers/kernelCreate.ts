import crypto from 'crypto';
import { Principal } from '../rbac';

export interface KernelCreatePayload {
  kernelId?: string;
  id?: string;
  name?: string;
  metadata?: unknown;
}

export interface KernelCreateResponse {
  kernelId: string;
  createdAt: string;
  requestedBy: string | null;
  name?: string;
  metadata?: unknown;
}

export interface KernelCreateRecord {
  key: string;
  principalId: string | null;
  status: number;
  response: KernelCreateResponse;
  createdAt: string;
}

export interface KernelCreateStore {
  get(key: string): Promise<KernelCreateRecord | null>;
  save(record: KernelCreateRecord): Promise<void>;
}

export class MissingIdempotencyKeyError extends Error {
  constructor() {
    super('missing_idempotency_key');
    this.name = 'MissingIdempotencyKeyError';
  }
}

export class IdempotencyKeyConflictError extends Error {
  constructor(message = 'idempotency_key_conflict') {
    super(message);
    this.name = 'IdempotencyKeyConflictError';
  }
}

function cloneResponse(resp: KernelCreateResponse): KernelCreateResponse {
  const clone: KernelCreateResponse = {
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

class MemoryKernelCreateStore implements KernelCreateStore {
  private records = new Map<string, KernelCreateRecord>();

  async get(key: string): Promise<KernelCreateRecord | null> {
    const record = this.records.get(key);
    if (!record) return null;
    return {
      key: record.key,
      principalId: record.principalId,
      status: record.status,
      createdAt: record.createdAt,
      response: cloneResponse(record.response),
    };
  }

  async save(record: KernelCreateRecord): Promise<void> {
    const copy: KernelCreateRecord = {
      key: record.key,
      principalId: record.principalId,
      status: record.status,
      createdAt: record.createdAt,
      response: cloneResponse(record.response),
    };
    this.records.set(record.key, copy);
  }
}

let defaultStore: KernelCreateStore = new MemoryKernelCreateStore();

export function setKernelCreateStore(store: KernelCreateStore): void {
  defaultStore = store;
}

export function resetKernelCreateStore(): void {
  defaultStore = new MemoryKernelCreateStore();
}

export function getKernelCreateStore(): KernelCreateStore {
  return defaultStore;
}

function normalizeIdempotencyKey(raw?: string | null): string {
  if (!raw || !raw.trim()) {
    throw new MissingIdempotencyKeyError();
  }
  return raw.trim();
}

export interface HandleKernelCreateOptions {
  store?: KernelCreateStore;
  now?: () => Date;
  idGenerator?: () => string;
}

export interface HandleKernelCreateInput {
  payload: KernelCreatePayload | undefined;
  principal?: Principal;
  idempotencyKey?: string | null;
  options?: HandleKernelCreateOptions;
}

export interface HandleKernelCreateResult {
  status: number;
  response: KernelCreateResponse;
  idempotent: boolean;
  key: string;
}

export async function handleKernelCreateRequest(
  input: HandleKernelCreateInput,
): Promise<HandleKernelCreateResult> {
  const { payload, principal, idempotencyKey, options } = input;
  const key = normalizeIdempotencyKey(idempotencyKey);
  const store = options?.store ?? getKernelCreateStore();
  const nowFn = options?.now ?? (() => new Date());
  const generateId = options?.idGenerator ?? (() => crypto.randomUUID());

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

  const response: KernelCreateResponse = {
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

  const record: KernelCreateRecord = {
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
