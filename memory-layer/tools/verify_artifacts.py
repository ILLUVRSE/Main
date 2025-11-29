#!/usr/bin/env python3
import os
import sys
import json
import hashlib
import argparse
from urllib.parse import urlparse

# This script verifies the integrity and provenance of artifacts in the Memory Layer.
# It connects to the Postgres DB (or uses JSON export) and S3 (or local storage).

DB_URL = os.environ.get("DATABASE_URL")
S3_BUCKET = os.environ.get("S3_BUCKET", "local")
AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")
MODE = os.environ.get("MODE", "mock") # mock or full
ARTIFACT_STORAGE_DIR = os.environ.get("ARTIFACT_STORAGE_DIR", "memory-layer/test/storage")

def get_db_connection():
    import psycopg2
    return psycopg2.connect(DB_URL)

def compute_sha256(data):
    return hashlib.sha256(data).hexdigest()

def get_s3_object(key):
    if MODE == "mock" or S3_BUCKET == "local":
        # Local FS
        path = os.path.join(os.getcwd(), ARTIFACT_STORAGE_DIR, key)
        try:
            with open(path, "rb") as f:
                return f.read()
        except FileNotFoundError:
            return None
    else:
        import boto3
        # Real S3
        s3 = boto3.client("s3", region_name=AWS_REGION)
        try:
            resp = s3.get_object(Bucket=S3_BUCKET, Key=key)
            return resp["Body"].read()
        except Exception as e:
            print(f"S3 Error: {e}")
            return None

def verify_artifacts(json_file=None):
    artifacts_data = []
    audit_lookup = {}

    print("--- Verifying Artifacts ---")

    if json_file:
        print(f"Loading metadata from {json_file}")
        with open(json_file, 'r') as f:
            data = json.load(f)
            # Expecting data = { "artifacts": [...], "audit_events": [...] }
            # Artifact format from DB: [id, sha256, s3_key, artifact_url, provenance_verified]
            # JSON format might be dicts, we adapt
            for art in data.get("artifacts", []):
                artifacts_data.append((
                    art.get("id"),
                    art.get("sha256"),
                    art.get("s3_key"),
                    art.get("artifact_url"),
                    art.get("provenance_verified")
                ))

            for audit in data.get("audit_events", []):
                aid = audit.get("artifact_id")
                if aid:
                    audit_lookup[aid] = audit
    else:
        if not DB_URL:
            print("DATABASE_URL env var is required when not using --json-file")
            return False

        try:
            conn = get_db_connection()
            cur = conn.cursor()

            # Fetch all artifacts
            cur.execute("""
                SELECT a.id, a.sha256, a.s3_key, a.artifact_url, a.provenance_verified
                FROM artifacts a
            """)
            artifacts_data = cur.fetchall()

            # For DB mode, we look up audits per artifact in the loop, or we could fetch all.
            # Let's keep logic similar: fetch on demand or prefetch.
            # To unify, let's prefetch or use a callback/helper for audit.
        except Exception as e:
            print(f"DB Connection failed: {e}")
            return False

    if not artifacts_data:
        print("No artifacts found.")
        return True

    success = True

    # Helper to get audit
    def get_audit(art_id):
        if json_file:
            return audit_lookup.get(art_id)
        else:
            cur.execute("""
                SELECT id, hash, signature
                FROM audit_events
                WHERE artifact_id = %s
                ORDER BY created_at DESC LIMIT 1
            """, (art_id,))
            row = cur.fetchone()
            if row:
                return {"id": row[0], "hash": row[1], "signature": row[2]}
            return None

    for art in artifacts_data:
        art_id, expected_sha, s3_key, url, verified_flag = art
        print(f"Checking Artifact {art_id} (SHA: {expected_sha[:8]}...)")

        # Determine key
        key = s3_key
        if not key and url and url.startswith("s3://"):
             # Extract key from URL
             parsed = urlparse(url)
             key = parsed.path.lstrip('/')

        if not key:
            print(f"  [FAIL] No s3_key or valid URL for artifact {art_id}")
            success = False
            continue

        # Fetch Content
        content = get_s3_object(key)
        if content is None:
            print(f"  [FAIL] Object not found: {key}")
            success = False
            continue

        # Verify Checksum
        actual_sha = compute_sha256(content)
        if actual_sha != expected_sha:
            print(f"  [FAIL] Checksum mismatch! DB: {expected_sha}, Actual: {actual_sha}")
            success = False
            continue

        print(f"  [PASS] Checksum verified.")

        # Verify Audit Linkage
        audit = get_audit(art_id)

        if not audit:
            print(f"  [FAIL] No audit event found for artifact {art_id}")
            success = False
            continue

        print(f"  [PASS] Audit event linked: {audit['id']}")

    if not json_file and 'conn' in locals():
        conn.close()

    return success

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--json-file", help="Path to JSON file with exported artifact/audit data")
    args = parser.parse_args()

    if verify_artifacts(args.json_file):
        print("All artifacts verified successfully.")
        sys.exit(0)
    else:
        print("Verification failed.")
        sys.exit(1)
