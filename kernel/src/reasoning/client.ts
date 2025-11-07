/**
 * kernel/src/reasoning/client.ts
 *
 * Minimal client for the reasoning-graph service. Responsible for fetching
 * reasoning traces, applying Sentinel-style PII redaction rules, and exposing
 * a configurable singleton used by the HTTP routes.
 */

import fetch from 'node-fetch';

export interface ReasoningTraceEntry {
  step?: number | string;
  ts?: string;
  note?: string;
  data?: Record<string, any> | string | null;
  [key: string]: any;
}

export interface ReasoningTraceResponse {
  node: string;
  trace: ReasoningTraceEntry[];
  metadata?: Record<string, any>;
}

export class ReasoningClientError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = 'ReasoningClientError';
  }
}

const REDACTION_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, replacement: '[REDACTED EMAIL]' },
  { pattern: /\b\d{3}-\d{2}-\d{4}\b/g, replacement: '[REDACTED SSN]' },
  { pattern: /\b(?:\d[ -]?){13,16}\b/g, replacement: '[REDACTED CARD]' },
  { pattern: /\b\d{3}-\d{3}-\d{4}\b/g, replacement: '[REDACTED PHONE]' },
];

function redactString(value: string): string {
  return REDACTION_PATTERNS.reduce((acc, rule) => acc.replace(rule.pattern, rule.replacement), value);
}

function deepCloneRedact(value: any): any {
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
    const out: Record<string, any> = {};
    for (const key of Object.keys(value)) {
      out[key] = deepCloneRedact(value[key]);
    }
    return out;
  }
  return value;
}

export class ReasoningClient {
  constructor(private baseUrl: string, private apiKey?: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }
    return headers;
  }

  async fetchTrace(nodeId: string): Promise<ReasoningTraceResponse> {
    const url = `${this.baseUrl}/reason/${encodeURIComponent(nodeId)}`;
    const res = await fetch(url, { headers: this.headers() });
    if (res.status === 404) {
      throw new ReasoningClientError('trace_not_found', 404);
    }
    if (!res.ok) {
      const text = await res.text();
      throw new ReasoningClientError(text || `reasoning service error (${res.status})`, res.status);
    }
    const payload = (await res.json()) as ReasoningTraceResponse;
    if (!payload || typeof payload !== 'object') {
      throw new ReasoningClientError('invalid_response', 502);
    }
    return payload;
  }

  redactTrace(trace: ReasoningTraceResponse): ReasoningTraceResponse {
    return {
      node: trace.node,
      metadata: trace.metadata ? deepCloneRedact(trace.metadata) : undefined,
      trace: Array.isArray(trace.trace)
        ? trace.trace.map((entry) => deepCloneRedact(entry))
        : [],
    };
  }

  async getRedactedTrace(nodeId: string): Promise<ReasoningTraceResponse> {
    const raw = await this.fetchTrace(nodeId);
    return this.redactTrace(raw);
  }
}

let sharedClient: ReasoningClient | null = null;

export function getReasoningClient(): ReasoningClient {
  if (!sharedClient) {
    const baseUrl = process.env.REASONING_GRAPH_URL || 'http://127.0.0.1:7600';
    sharedClient = new ReasoningClient(baseUrl, process.env.REASONING_GRAPH_API_KEY);
  }
  return sharedClient;
}

export function setReasoningClient(client: ReasoningClient | null): void {
  sharedClient = client;
}

