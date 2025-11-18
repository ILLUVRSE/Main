#!/usr/bin/env python3
"""
tools/check_acceptance.py

Simple checker for the FINAL_COMPLETION_BLUEPRINT.md required artifacts.

Exit codes:
 0 - all required items present
 2 - missing items

Usage:
  python3 tools/check_acceptance.py
"""

from __future__ import annotations
import os
import sys
from pathlib import Path
from typing import List, Tuple, Union

PROJECT_ROOT = Path(__file__).resolve().parents[1]  # repo root

# Define the exact set of items we flagged missing.
# Use strings for single paths, tuples/lists for alternatives.
REQUIRED_ITEMS: List[Union[str, Tuple[str, ...]]] = [
    # Global / repo-level
    "tools/check_acceptance.py",  # this file (should be present)
    "scripts/run_final_audit.sh",
    "scripts/check_signoffs.sh",
    "progress",  # optional directory expected by some tooling (check as dir)

    # Kernel
    "kernel/signoffs/security_engineer.sig",
    "kernel/signoffs/ryan.sig",
    "kernel/.gitignore",

    # Agent Manager
    ("agent-manager/openapi.yaml", "agent-manager/api.md"),
    "agent-manager/security-governance.md",
    "agent-manager/signoffs/security_engineer.sig",
    "agent-manager/signoffs/ryan.sig",

    # Memory Layer
    ("memory-layer/api/openapi.yaml", "memory-layer/api.md"),
    "memory-layer/signoffs/ryan.sig",
    "memory-layer/signoffs/security_engineer.sig",

    # Reasoning Graph
    "reasoning-graph/signoffs/security_engineer.sig",
    "reasoning-graph/signoffs/ryan.sig",

    # Eval Engine & Resource Allocator
    ("eval-engine/api.md", "eval-engine/openapi.yaml"),
    "eval-engine/deployment.md",
    "eval-engine/security-governance.md",
    "eval-engine/audit-log-spec.md",
    "eval-engine/operational-runbook.md",
    "eval-engine/signoffs/security_engineer.sig",
    "eval-engine/signoffs/ryan.sig",

    # SentinelNet
    ("sentinelnet/api.md", "sentinelnet/openapi.yaml"),
    "sentinelnet/signoffs/security_engineer.sig",
    "sentinelnet/signoffs/ryan.sig",

    # AI & Infrastructure
    "ai-infra/deployment.md",
    ("ai-infra/api.md", "ai-infra/model-registry.md"),
    "ai-infra/signoffs/ml_lead.sig",
    "ai-infra/signoffs/security_engineer.sig",

    # Marketplace
    "marketplace/signoffs/ryan.sig",

    # Finance
    "finance/signoffs/security_engineer.sig",
    "finance/signoffs/finance_lead.sig",

    # Control-Panel
    "control-panel/deployment.md",
    "control-panel/signoffs/security_engineer.sig",
    "control-panel/signoffs/ryan.sig",

    # RepoWriter
    "RepoWriter/signoffs/security_engineer.sig",
    "RepoWriter/signoffs/ryan.sig",

    # ArtifactPublisher
    "artifact-publisher/server/signoffs/security_engineer.sig",
    ("artifact-publisher/server/signoffs/marketplace_lead.sig",
     "artifact-publisher/server/signoffs/ryan.sig"),

    # IDEA
    "IDEA/deployment.md",
    ("IDEA/api.md", "IDEA/openapi.yaml"),
    "IDEA/README.md",
    "IDEA/signoffs/ryan.sig",
]


def exists_any(root: Path, alternatives: Tuple[str, ...]) -> bool:
    for alt in alternatives:
        p = root / alt
        if p.exists():
            return True
    return False


def format_path(p: Union[str, Tuple[str, ...]]) -> str:
    if isinstance(p, str):
        return p
    return "  OR  ".join(p)


def main() -> int:
    root = PROJECT_ROOT
    print(f"Checking repository acceptance artifacts under: {root}\n")

    missing = []
    present = []

    for item in REQUIRED_ITEMS:
        if isinstance(item, str):
            target = root / item
            if item.endswith("/") or item.endswith("\\"):
                ok = target.is_dir()
            else:
                # Special case: `progress` often optional - treat presence or not, but report it.
                ok = target.exists()
            if ok:
                present.append(item)
            else:
                missing.append(item)
        else:
            # tuple/list of alternatives
            if exists_any(root, tuple(item)):
                present.append(item)
            else:
                missing.append(item)

    # Print results
    print("Summary:")
    print(f"  Required items checked : {len(REQUIRED_ITEMS)}")
    print(f"  Present                : {len(present)}")
    print(f"  Missing                : {len(missing)}\n")

    if present:
        print("Present (examples):")
        for p in present[:20]:
            print("  -", format_path(p) if isinstance(p, tuple) else p)
        if len(present) > 20:
            print("  ...")
        print("")

    if missing:
        print("Missing items (these block platform completion):")
        for p in missing:
            # If p is a tuple/list, show alternatives clearly
            if isinstance(p, tuple):
                print("  - (one-of) " + "  OR  ".join(p))
            else:
                print("  -", p)
        print("\nNext steps:")
        print("  - Create the missing files (or an acceptable alternative for one-of slots).")
        print("  - Add signoff files under each module in '**/signoffs/*.sig' once reviewers sign.")
        print("  - Re-run this script until the missing list is empty.")
        return 2

    print("All required items are present. You can proceed to run final-audit scripts.")
    return 0


if __name__ == "__main__":
    rc = main()
    sys.exit(rc)

