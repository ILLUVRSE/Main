-- marketplace/data/e2e-skus.sql
-- Seed data for E2E tests: creates sku "e2e-sku-001" and a royalty rule.

INSERT INTO skus (sku_id, title, summary, price, currency, manifest_metadata, manifest_signature_id, manifest_valid, tags, author_id, created_at)
VALUES (
  'e2e-sku-001',
  'E2E Test SKU',
  'SKU used by the E2E tests (checkout/e2e).',
  1000, -- price in cents (10.00 USD)
  'USD',
  $${
    "id": "e2e-sku-001",
    "title": "E2E Test SKU",
    "version": "1.0.0",
    "checksum": "sha256:abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
    "author": { "id": "actor:alice", "name": "Alice" },
    "license": { "type": "single-user", "terms": "E2E test license terms" },
    "artifacts": [
      {
        "artifact_id": "art-001",
        "artifact_url": "s3://marketplace-artifacts/e2e-sku-001/art-001",
        "sha256": "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef"
      }
    ],
    "metadata": { "size_bytes": 12345 },
    "manifest_signature": {
      "signer_kid": "kernel-signer-v1",
      "signature": "dummy-signature-base64",
      "ts": "2025-11-17T12:34:56Z"
    }
  }$$::jsonb,
  'manifest-sig-e2e-001',
  true,
  ARRAY['e2e','test'],
  'actor:alice',
  now()
)
ON CONFLICT (sku_id) DO UPDATE
  SET title = EXCLUDED.title,
      summary = EXCLUDED.summary,
      price = EXCLUDED.price,
      currency = EXCLUDED.currency,
      manifest_metadata = EXCLUDED.manifest_metadata,
      manifest_signature_id = EXCLUDED.manifest_signature_id,
      manifest_valid = EXCLUDED.manifest_valid,
      tags = EXCLUDED.tags,
      author_id = EXCLUDED.author_id;

-- Optional royalty rule to exercise royalty flows (10% to Alice)
INSERT INTO royalties (sku_id, rule, created_at)
VALUES (
  'e2e-sku-001',
  $${
    "type": "percentage",
    "splits": [
      { "recipient": "actor:alice", "percentage": 10 }
    ],
    "notes": "E2E royalty: 10% to author"
  }$$::jsonb,
  now()
)
ON CONFLICT DO NOTHING;

