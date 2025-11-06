import { PoolClient, QueryResult } from 'pg';

type IdempotencyRow = {
  key: string;
  method: string;
  path: string;
  request_hash: string;
  response_status: number | null;
  response_body: string | null;
  created_at: string;
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

type DbState = {
  idempotency: Map<string, IdempotencyRow>;
  manifest_signatures: Map<string, ManifestSignatureRow>;
  divisions: Map<string, DivisionRow>;
  agents: Map<string, AgentRow>;
  eval_reports: Map<string, EvalReportRow>;
  resource_allocations: Map<string, AllocationRow>;
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
    manifest_signatures: cloneMap(source.manifest_signatures),
    divisions: cloneMap(source.divisions),
    agents: cloneMap(source.agents),
    eval_reports: cloneMap(source.eval_reports),
    resource_allocations: cloneMap(source.resource_allocations),
  };
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
    manifest_signatures: new Map(),
    divisions: new Map(),
    agents: new Map(),
    eval_reports: new Map(),
    resource_allocations: new Map(),
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
        },
      ],
    };
  }

  private insertIdempotency(params: any[]): QueryResult<any> {
    const [key, method, path, requestHash] = params;
    this.state.idempotency.set(key, {
      key,
      method,
      path,
      request_hash: requestHash,
      response_status: null,
      response_body: null,
      created_at: nowIso(),
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

  async handleQuery(text: string, params: any[]): Promise<QueryResult<any>> {
    const normalized = text.replace(/\s+/g, ' ').trim();
    const lower = normalized.toLowerCase();

    if (lower === 'begin') return this.begin();
    if (lower === 'commit') return this.commit();
    if (lower === 'rollback') return this.rollback();

    if (lower.startsWith('select') && lower.includes('from idempotency')) {
      return this.selectIdempotency(params[0]);
    }
    if (lower.startsWith('insert into idempotency')) {
      return this.insertIdempotency(params);
    }
    if (lower.startsWith('update idempotency set')) {
      return this.updateIdempotency(params);
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

    throw new Error(`Unsupported query in MockDb: ${text}`);
  }
}
