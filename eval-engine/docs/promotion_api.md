# Eval Engine Promotion API

## Overview

The Promotion API allows authorized agents/services (via Kernel) to request promotion of models, agents, or artifacts. This triggers a Reasoning Graph decision event and Finance resource allocation.

## Endpoints

### POST /eval/promote

Promotes an artifact.

**Request Body:**

```json
{
  "requestId": "promo-uuid",
  "artifactId": "model-v1",
  "reason": "Performance improved",
  "score": 0.95,
  "confidence": 0.9,
  "evidence": { "eval_id": "..." },
  "target": { "env": "prod" },
  "audit_context": { "kernel_manifest_signature_id": "sig-123" },
  "idempotency_key": "unique-key"
}
```

**Response:**

```json
{
  "ok": true,
  "promotion_id": "promo-uuid-generated",
  "status": "accepted"
}
```

### POST /alloc/request

Requests resource allocation.

**Request Body:**

```json
{
  "id": "alloc-uuid",
  "entity_id": "agent-v1",
  "resources": { "cpu": 4, "gpu": 1 },
  "idempotency_key": "alloc-key",
  "audit_context": { ... }
}
```

**Response:**

```json
{
  "ok": true,
  "allocation_id": "alloc-uuid",
  "status": "reserved",
  "details": { ... }
}
```
