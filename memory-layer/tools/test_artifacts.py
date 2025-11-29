#!/usr/bin/env python3
import os
import sys
import json
import hashlib
import uuid
import subprocess
import time

# Master test script for Artifact Provenance
# 1. Runs Integration Tests (Jest)
# 2. Runs Verification Tool (Python) against generated mock data

def run_integration_tests():
    print(">>> Running Integration Tests (pg-mem)...")
    try:
        subprocess.check_call([
            "npx", "jest", "memory-layer/test/integration/artifacts.integration.test.ts"
        ])
        print(">>> Integration tests PASSED.")
        return True
    except subprocess.CalledProcessError:
        print(">>> Integration tests FAILED.")
        return False

def setup_mock_data():
    print(">>> Setting up mock data for verification tool...")

    storage_dir = "memory-layer/test/storage"
    if not os.path.exists(storage_dir):
        os.makedirs(storage_dir)

    # Create dummy artifact
    content = b"Verification Tool Test Content"
    sha256 = hashlib.sha256(content).hexdigest()

    # Path: artifacts/<sha256>
    key = f"artifacts/{sha256}"
    path = os.path.join(storage_dir, "artifacts", sha256)
    os.makedirs(os.path.dirname(path), exist_ok=True)

    with open(path, "wb") as f:
        f.write(content)

    print(f"Created mock artifact at {path}")

    # Create JSON dump
    art_id = str(uuid.uuid4())
    audit_id = str(uuid.uuid4())

    data = {
        "artifacts": [
            {
                "id": art_id,
                "sha256": sha256,
                "s3_key": key,
                "artifact_url": f"s3://local/{key}",
                "provenance_verified": True
            }
        ],
        "audit_events": [
            {
                "id": audit_id,
                "artifact_id": art_id,
                "hash": "mock-hash",
                "signature": "mock-sig"
            }
        ]
    }

    json_path = "memory-layer/test/artifacts_export.json"
    with open(json_path, "w") as f:
        json.dump(data, f)

    return json_path

def run_verification_tool(json_path):
    print(">>> Running Verification Tool (Python)...")
    try:
        subprocess.check_call([
            "python3", "memory-layer/tools/verify_artifacts.py",
            "--json-file", json_path
        ], env={**os.environ, "ARTIFACT_STORAGE_DIR": "memory-layer/test/storage"})
        print(">>> Verification tool PASSED.")
        return True
    except subprocess.CalledProcessError:
        print(">>> Verification tool FAILED.")
        return False

def main():
    # 1. Integration Tests
    if not run_integration_tests():
        sys.exit(1)

    # 2. Python Tool Verification (Mock Mode)
    json_path = setup_mock_data()
    if not run_verification_tool(json_path):
        sys.exit(1)

    # Cleanup
    if os.path.exists(json_path):
        os.remove(json_path)

    print("\nALL CHECKS PASSED.")
    sys.exit(0)

if __name__ == "__main__":
    main()
