import { randomUUID } from 'crypto';
import { PoolClient, QueryResult } from 'pg';

type IdempotencyRow = {
  key: string;
  method: string;
  path: string;
  request_hash: string;
  response_status: number | null;
  response_body: string | null;
  created_at: string;
  expires_at: string | null;
};

type ManifestSignatureRow = {
  id: string;
  manifest_id: string | null;
  signer_id: string | null;
  signature: string;
  version: string | null;
  ts: string | null;
  prev_hash: string | null;
};

type DivisionRow = {
  id: string;
  name: string | null;
  goals: string | null;
  budget: number;
  currency: string | null;
  kpis: string | null;
  policies: string | null;
  metadata: string | null;
  status: string | null;
  version: string | null;
  manifest_signature_id: string | null;
  created_at: string;
  updated_at: string;
};

type AgentRow = {
  id: string;
  template_id: string | null;
  role: string | null;
  skills: string | null;
  code_ref: string | null;
  division_id: string | null;
  state: string;
  score: number;
  resource_allocation: string | null;
  last_heartbeat: string;
  owner: string | null;
  created_at: string;
  updated_at: string;
};

type EvalReportRow = {
  id: string;
  agent_id: string;
  metric_set: string | null;
  timestamp: string;
  source: string | null;
  computed_score: number | null;
  window: string | null;
};

type AllocationRow = {
  id: string;
  entity_id: string;
  pool: string | null;
  delta: number;
  reason: string | null;
  requested_by: string;
  status: string;
  ts: string;
};

type UpgradeRow = {
  id: string;
  upgrade_id: string;
  manifest: any;
  status: string;
  submitted_by: string | null;
  submitted_at: string;
  applied_at: string | null;
  applied_by: string | null;
};

type UpgradeApprovalRow = {
  id: string;
  upgrade_id: string;
  approver_id: string;
  signature: string;
  notes: string | null;
  approved_at: string;
};

type AuditEventRow = {
  id: string;
  event_type: string | null;
  payload: any;
  payload_key: string;
  prev_hash: string | null;
  hash: string;
  signature: string | null;
  signer_id: string | null;
  algorithm: string | null;
  sampled: boolean;
  ts: string;
};

type DbState = {
  audit_events: Map<string, AuditEventRow>;
  audit_event_payload_index: Map<string, string>;
  idempotency: Map<string, IdempotencyRow>;
  manifest_signatures: Map<string, ManifestSignatureRow>;
  divisions: Map<string, DivisionRow>;
  agents: Map<string, AgentRow>;
  eval_reports: Map<string, EvalReportRow>;
  resource_allocations: Map<string, AllocationRow>;
  upgrades: Map<string, UpgradeRow>;
  upgradesByCode: Map<string, string>;
  upgradeApprovals: Map<string, Map<string, UpgradeApprovalRow>>;
};

function nowIso(): string {
  return new Date().toISOString();
}

function cloneState(source: DbState): DbState {
  const cloneMap = <T>(map: Map<string, T>): Map<string, T> => {
    return new Map<string, T>(Array.from(map.entries()).map(([k, v]) => [k, { ...(v as any) }]));
  };

  return {
    idempotency: cloneMap(source.idempotency),
    audit_events: cloneMap(source.audit_events),
    audit_event_payload_index: new Map(source.audit_event_payload_index.entries()),
    manifest_signatures: cloneMap(source.manifest_signatures),
    divisions: cloneMap(source.divisions),
    agents: cloneMap(source.agents),
    eval_reports: cloneMap(source.eval_reports),
    resource_allocations: cloneMap(source.resource_allocations),
    upgrades: cloneMap(source.upgrades),
    upgradesByCode: new Map(source.upgradesByCode.entries()),
    upgradeApprovals: new Map(
      Array.from(source.upgradeApprovals.entries()).map(([upgradeId, approvals]) => [
        upgradeId,
        new Map(Array.from(approvals.entries()).map(([approverId, row]) => [approverId, { ...(row as any) }])),
      ]),
    ),
  };
}

function payloadKeyForDedup(value: any): string {
  const clone = value === undefined ? null : JSON.parse(JSON.stringify(value ?? null));
  const scrub = (obj: any): any => {
    if (!obj || typeof obj !== 'object') return obj;
    if ('traceId' in obj) {
      delete obj.traceId;
    }
    return obj;
  };
  const normalized = scrub(clone);
  if (normalized && typeof normalized === 'object' && normalized.value) {
    normalized.value = scrub(normalized.value);
  }
  return JSON.stringify(normalized);
}

class MockClient {
  constructor(private readonly db: MockDb) {}

  async query(text: string, params?: any[]): Promise<QueryResult<any>> {
    return this.db.handleQuery(text, params ?? []);
  }

  release(): void {
    // no-op
  }
}

const EMPTY_RESULT: QueryResult<any> = { rows: [], rowCount: 0, command: '', oid: 0, fields: [] };

export class MockDb {
  private state: DbState = {
    idempotency: new Map(),
    audit_events: new Map(),
    audit_event_payload_index: new Map(),
    manifest_signatures: new Map(),
    divisions: new Map(),
    agents: new Map(),
    eval_reports: new Map(),
    resource_allocations: new Map(),
    upgrades: new Map(),
    upgradesByCode: new Map(),
    upgradeApprovals: new Map(),
  };

  private snapshots: DbState[] = [];

  createClient(): PoolClient {
    return new MockClient(this) as unknown as PoolClient;
  }

  getState(): DbState {
    return cloneState(this.state);
  }

  private begin(): QueryResult<any> {
    this.snapshots.push(cloneState(this.state));
    return EMPTY_RESULT;
  }

  private commit(): QueryResult<any> {
    this.snapshots.pop();
    return EMPTY_RESULT;
  }

  private rollback(): QueryResult<any> {
    const snapshot = this.snapshots.pop();
    if (snapshot) {
      this.state = snapshot;
    }
    return EMPTY_RESULT;
  }

  private selectIdempotency(key: string): QueryResult<any> {
    const row = this.state.idempotency.get(key);
    if (!row) return { ...EMPTY_RESULT };
    return {
      ...EMPTY_RESULT,
      rowCount: 1,
      rows: [
        {
          key: row.key,
          method: row.method,
          path: row.path,
          request_hash: row.request_hash,
          response_status: row.response_status,
          response_body: row.response_body,
          expires_at: row.expires_at,
        },
      ],
    };
  }

  private insertIdempotency(params: any[]): QueryResult<any> {
    const [key, method, path, requestHash, expiresAt] = params;
    this.state.idempotency.set(key, {
      key,
      method,
      path,
      request_hash: requestHash,
      response_status: null,
      response_body: null,
      created_at: nowIso(),
      expires_at: expiresAt ?? null,
    });
    return { ...EMPTY_RESULT, rowCount: 1 };
  }

  private updateIdempotency(params: any[]): QueryResult<any> {
    const [key, status, body] = params;
    const existing = this.state.idempotency.get(key);
    if (existing) {
      existing.response_status = status;
      existing.response_body = body;
    }
    return { ...EMPTY_RESULT, rowCount: existing ? 1 : 0 };
  }

  private listIdempotency(limitParam: any): QueryResult<any> {
    const limit = Number(limitParam) || 0;
    const rows = Array.from(this.state.idempotency.values())
      .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0))
      .slice(0, limit || this.state.idempotency.size)
      .map((row) => ({ ...row }));
    return {
      ...EMPTY_RESULT,
      rowCount: rows.length,
      rows,
    };
  }

  private insertManifestSignature(params: any[]): QueryResult<any> {
    const [id, manifestId, signerId, signature, version, ts, prevHash] = params;
    this.state.manifest_signatures.set(id, {
      id,
      manifest_id: manifestId ?? null,
      signer_id: signerId ?? null,
      signature,
      version: version ?? null,
      ts: ts ?? nowIso(),
      prev_hash: prevHash ?? null,
    });
    return { ...EMPTY_RESULT, rowCount: 1 };
  }

  private upsertDivision(params: any[]): QueryResult<any> {
    const [
      id,
      name,
      goals,
      budget,
      currency,
      kpis,
      policies,
      metadata,
      status,
      version,
      manifestSignatureId,
    ] = params;
    const row: DivisionRow = {
      id,
      name,
      goals,
      budget: Number(budget ?? 0),
      currency,
      kpis,
      policies,
      metadata,
      status,
      version,
      manifest_signature_id: manifestSignatureId ?? null,
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    this.state.divisions.set(id, row);
    return { ...EMPTY_RESULT, rowCount: 1 };
  }

  private insertAgent(params: any[]): QueryResult<any> {
    const [
      id,
      templateId,
      role,
      skills,
      codeRef,
      divisionId,
      state,
      score,
      resourceAllocation,
      owner,
    ] = [
      params[0],
      params[1],
      params[2],
      params[3],
      params[4],
      params[5],
      params[6],
      params[7],
      params[8],
      params[9],
    ];
    const row: AgentRow = {
      id,
      template_id: templateId ?? null,
      role: role ?? null,
      skills: skills ?? null,
      code_ref: codeRef ?? null,
      division_id: divisionId ?? null,
      state,
      score: Number(score ?? 0),
      resource_allocation: resourceAllocation ?? null,
      last_heartbeat: nowIso(),
      owner: owner ?? null,
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    this.state.agents.set(id, row);
    return { ...EMPTY_RESULT, rowCount: 1 };
  }

  private selectAgent(id: string): QueryResult<any> {
    const row = this.state.agents.get(id);
    if (!row) return { ...EMPTY_RESULT };
    return { ...EMPTY_RESULT, rowCount: 1, rows: [row] };
  }

  private updateAgentScore(score: number, id: string): QueryResult<any> {
    const row = this.state.agents.get(id);
    if (row) {
      row.score = score;
      row.updated_at = nowIso();
    }
    return { ...EMPTY_RESULT, rowCount: row ? 1 : 0 };
  }

  private insertEval(params: any[]): QueryResult<any> {
    const [id, agentId, metricSet, timestamp, source, computedScore, window] = params;
    const row: EvalReportRow = {
      id,
      agent_id: agentId,
      metric_set: metricSet ?? null,
      timestamp: timestamp ?? nowIso(),
      source: source ?? null,
      computed_score: computedScore ?? null,
      window: window ?? null,
    };
    this.state.eval_reports.set(id, row);
    return { ...EMPTY_RESULT, rowCount: 1 };
  }

  private insertAllocation(params: any[]): QueryResult<any> {
    const [id, entityId, pool, delta, reason, requestedBy, status] = params;
    const row: AllocationRow = {
      id,
      entity_id: entityId,
      pool: pool ?? null,
      delta: Number(delta ?? 0),
      reason: reason ?? null,
      requested_by: requestedBy ?? 'system',
      status: status ?? 'pending',
      ts: nowIso(),
    };
    this.state.resource_allocations.set(id, row);
    return { ...EMPTY_RESULT, rowCount: 1 };
  }

  private insertUpgrade(params: any[]): QueryResult<any> {
    const [upgradeId, manifest, submittedBy] = params;
    if (this.state.upgradesByCode.has(upgradeId)) {
      const error: any = new Error('duplicate key value violates unique constraint "upgrades_upgrade_id_key"');
      error.code = '23505';
      throw error;
    }
    const id = randomUUID();
    const ts = nowIso();
    const row: UpgradeRow = {
      id,
      upgrade_id: upgradeId,
      manifest: manifest ?? {},
      status: 'pending',
      submitted_by: submittedBy ?? null,
      submitted_at: ts,
      applied_at: null,
      applied_by: null,
    };
    this.state.upgrades.set(id, row);
    this.state.upgradesByCode.set(upgradeId, id);
    return {
      ...EMPTY_RESULT,
      rowCount: 1,
      rows: [{ ...row }],
    };
  }

  private selectUpgradeByCode(upgradeId: string): QueryResult<any> {
    const id = this.state.upgradesByCode.get(upgradeId);
    if (!id) return { ...EMPTY_RESULT };
    const row = this.state.upgrades.get(id);
    if (!row) return { ...EMPTY_RESULT };
    return {
      ...EMPTY_RESULT,
      rowCount: 1,
      rows: [{ ...row }],
    };
  }

  private insertUpgradeApproval(params: any[]): QueryResult<any> {
    const [upgradeUuid, approverId, signature, notes] = params;
    const upgradeId = String(upgradeUuid);
    const upgrade = this.state.upgrades.get(upgradeId);
    if (!upgrade) {
      throw new Error('upgrade_not_found');
    }
    let approvals = this.state.upgradeApprovals.get(upgradeId);
    if (!approvals) {
      approvals = new Map();
      this.state.upgradeApprovals.set(upgradeId, approvals);
    }
    if (approvals.has(approverId)) {
      const error: any = new Error('duplicate key value violates unique constraint "upgrade_approvals_upgrade_id_approver_id_key"');
      error.code = '23505';
      throw error;
    }
    const row: UpgradeApprovalRow = {
      id: randomUUID(),
      upgrade_id: upgradeId,
      approver_id: approverId,
      signature,
      notes: notes ?? null,
      approved_at: nowIso(),
    };
    approvals.set(approverId, row);
    return {
      ...EMPTY_RESULT,
      rowCount: 1,
      rows: [{ ...row }],
    };
  }

  private selectUpgradeApprovals(upgradeUuid: string): QueryResult<any> {
    const approvals = this.state.upgradeApprovals.get(String(upgradeUuid));
    if (!approvals) return { ...EMPTY_RESULT };
    const rows = Array.from(approvals.values()).map((row) => ({ ...row }));
    return {
      ...EMPTY_RESULT,
      rowCount: rows.length,
      rows,
    };
  }

  private updateUpgradeApplied(appliedBy: string, upgradeUuid: string): QueryResult<any> {
    const key = String(upgradeUuid);
    const existing = this.state.upgrades.get(key);
    if (!existing) return { ...EMPTY_RESULT };
    const updated: UpgradeRow = {
      ...existing,
      status: 'applied',
      applied_by: appliedBy ?? null,
      applied_at: nowIso(),
    };
    this.state.upgrades.set(key, updated);
    return {
      ...EMPTY_RESULT,
      rowCount: 1,
      rows: [{ ...updated }],
    };
  }

  private insertAuditEvent(params: any[]): QueryResult<any> {
    const [
      idParam,
      eventType,
      payload,
      prevHash,
      hashParam,
      signature,
      signerId,
      algorithm,
      sampled,
    ] = params;
    const id = (idParam && String(idParam)) || randomUUID();
    const hash = (hashParam && String(hashParam)) || randomUUID().replace(/-/g, '');

    const payloadKey = payloadKeyForDedup(payload);

    const findExisting = (predicate: (row: AuditEventRow) => boolean) =>
      Array.from(this.state.audit_events.values())
        .filter(predicate)
        .sort((a, b) => (a.ts < b.ts ? 1 : -1))[0];

    const matchByHash = findExisting((row) => row.hash === String(hashParam));
    if (matchByHash) {
      return {
        ...EMPTY_RESULT,
        rowCount: 1,
        rows: [{ id: matchByHash.id, hash: matchByHash.hash, ts: matchByHash.ts }],
      };
    }

    const dedupeKey = JSON.stringify({ eventType: eventType ?? null, payloadKey });
    const existingId = this.state.audit_event_payload_index.get(dedupeKey);
    if (existingId) {
      const existingRow = this.state.audit_events.get(existingId);
      if (existingRow) {
        return {
          ...EMPTY_RESULT,
          rowCount: 1,
          rows: [{ id: existingRow.id, hash: existingRow.hash, ts: existingRow.ts }],
        };
      }
    }

    const matchByPayload = findExisting(
      (row) => row.event_type === (eventType ?? null) && row.payload_key === payloadKey,
    );
    if (matchByPayload) {
      this.state.audit_event_payload_index.set(dedupeKey, matchByPayload.id);
      return {
        ...EMPTY_RESULT,
        rowCount: 1,
        rows: [{ id: matchByPayload.id, hash: matchByPayload.hash, ts: matchByPayload.ts }],
      };
    }

    const storedPayload = payload === undefined ? null : JSON.parse(JSON.stringify(payload ?? null));
    const row: AuditEventRow = {
      id,
      event_type: eventType ?? null,
      payload: storedPayload,
      payload_key: payloadKey,
      prev_hash: prevHash ?? null,
      hash,
      signature: signature ?? null,
      signer_id: signerId ?? null,
      algorithm: algorithm ?? null,
      sampled: typeof sampled === 'boolean' ? sampled : false,
      ts: nowIso(),
    };
    this.state.audit_events.set(id, row);
    this.state.audit_event_payload_index.set(dedupeKey, id);
    return {
      ...EMPTY_RESULT,
      rowCount: 1,
      rows: [{ id: row.id, hash: row.hash, ts: row.ts }],
    };
  }

  private selectAuditEventById(id: string): QueryResult<any> {
    const row = this.state.audit_events.get(id);
    if (!row) return { ...EMPTY_RESULT };
    return { ...EMPTY_RESULT, rowCount: 1, rows: [{ ...row }] };
  }

  private selectAuditEventByHash(hash: string): QueryResult<any> {
    const matches = Array.from(this.state.audit_events.values())
      .filter((row) => row.hash === hash)
      .sort((a, b) => (a.ts < b.ts ? 1 : -1));
    if (!matches.length) return { ...EMPTY_RESULT };
    const { id, hash: storedHash, ts } = matches[0];
    return {
      ...EMPTY_RESULT,
      rowCount: 1,
      rows: [{ id, hash: storedHash, ts }],
    };
  }

  private selectLastAuditHash(): QueryResult<any> {
    const rows = Array.from(this.state.audit_events.values()).sort((a, b) => (a.ts < b.ts ? 1 : -1));
    if (!rows.length) return { ...EMPTY_RESULT };
    return {
      ...EMPTY_RESULT,
      rowCount: 1,
      rows: [{ hash: rows[0].hash }],
    };
  }

  async handleQuery(text: string, params: any[]): Promise<QueryResult<any>> {
    const normalized = text.replace(/\s+/g, ' ').trim();
    const lower = normalized.toLowerCase();

    if (lower === 'begin') return this.begin();
    if (lower === 'commit') return this.commit();
    if (lower === 'rollback') return this.rollback();

    if (lower.startsWith('select') && lower.includes('from idempotency') && lower.includes('where key')) {
      return this.selectIdempotency(params[0]);
    }
    if (lower.startsWith('select') && lower.includes('from idempotency') && lower.includes('order by')) {
      return this.listIdempotency(params[0]);
    }
    if (lower.startsWith('insert into idempotency')) {
      return this.insertIdempotency(params);
    }
    if (lower.startsWith('update idempotency set')) {
      return this.updateIdempotency(params);
    }
    if (lower.startsWith('insert into audit_events')) { return this.insertAuditEvent(params); }
    if (
      lower.startsWith('select hash from audit_events') &&
      lower.includes('order by ts desc') &&
      lower.includes('limit 1')
    ) {
      return this.selectLastAuditHash();
    }
    if (
      lower.startsWith('select id, hash, ts from audit_events where hash = $1 limit 1') ||
      (lower.startsWith('select') && lower.includes('from audit_events') && lower.includes('where hash = $1 limit 1'))
    ) {
      return this.selectAuditEventByHash(params[0]);
    }
    if (lower.startsWith('select') && lower.includes('from audit_events') && lower.includes('where id')) {
      return this.selectAuditEventById(params[0]);
    }
    if (lower.startsWith('insert into manifest_signatures')) {
      return this.insertManifestSignature(params);
    }
    if (lower.startsWith('insert into divisions')) {
      return this.upsertDivision(params);
    }
    if (lower.startsWith('insert into agents')) {
      return this.insertAgent(params);
    }
    if (lower.startsWith('select * from agents')) {
      return this.selectAgent(params[0]);
    }
    if (lower.startsWith('update agents set score')) {
      return this.updateAgentScore(params[0], params[1]);
    }
    if (lower.startsWith('insert into eval_reports')) {
      return this.insertEval(params);
    }
    if (lower.startsWith('insert into resource_allocations')) {
      return this.insertAllocation(params);
    }
    if (lower.startsWith('insert into upgrades')) {
      return this.insertUpgrade(params);
    }
    if (lower.startsWith('select') && lower.includes('from upgrades') && lower.includes('where upgrade_id = $1')) {
      return this.selectUpgradeByCode(params[0]);
    }
    if (lower.startsWith('insert into upgrade_approvals')) {
      return this.insertUpgradeApproval(params);
    }
    if (lower.startsWith('select approver_id from upgrade_approvals where upgrade_id = $1')) {
      return this.selectUpgradeApprovals(params[0]);
    }
    if (lower.startsWith('update upgrades') && lower.includes('set status =')) {
      return this.updateUpgradeApplied(params[0], params[1]);
    }

    throw new Error(`Unsupported query in MockDb: ${text}`);
  }
}
