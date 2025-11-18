#!/usr/bin/env bash
set -euo pipefail

# scripts/check_signoffs.sh
# Check for required module signoff files used by FINAL_COMPLETION_BLUEPRINT.md.
#
# Exit codes:
#   0 - all signoffs present
#   2 - missing signoffs

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

declare -a REQUIRED_SINGLE=(
  "kernel/signoffs/security_engineer.sig"
  "kernel/signoffs/ryan.sig"

  "agent-manager/signoffs/security_engineer.sig"
  "agent-manager/signoffs/ryan.sig"

  "memory-layer/signoffs/security_engineer.sig"
  "memory-layer/signoffs/ryan.sig"

  "reasoning-graph/signoffs/security_engineer.sig"
  "reasoning-graph/signoffs/ryan.sig"

  "eval-engine/signoffs/security_engineer.sig"
  "eval-engine/signoffs/ryan.sig"

  "sentinelnet/signoffs/security_engineer.sig"
  "sentinelnet/signoffs/ryan.sig"

  "ai-infra/signoffs/ml_lead.sig"
  "ai-infra/signoffs/security_engineer.sig"

  "marketplace/signoffs/ryan.sig"

  "finance/signoffs/security_engineer.sig"
  "finance/signoffs/finance_lead.sig"

  "control-panel/signoffs/security_engineer.sig"
  "control-panel/signoffs/ryan.sig"

  "RepoWriter/signoffs/security_engineer.sig"
  "RepoWriter/signoffs/ryan.sig"

  "artifact-publisher/server/signoffs/security_engineer.sig"

  "IDEA/signoffs/ryan.sig"
)

# Items where any one of alternatives is acceptable
# Format: "desc:::path1|||path2|||pathN"
declare -a REQUIRED_ALTERNATIVES=(
  "artifact-publisher_signoff_any:::artifact-publisher/server/signoffs/marketplace_lead.sig|||artifact-publisher/server/signoffs/ryan.sig"
)

# helper functions
exists() {
  local p="$1"
  [ -e "$REPO_ROOT/$p" ]
}

print_header() {
  echo
  echo "=== check_signoffs.sh ==="
  echo "Repository: $REPO_ROOT"
  echo
}

print_result() {
  echo
  echo "Summary:"
  echo "  Total required single signoffs : ${#REQUIRED_SINGLE[@]}"
  echo "  Total alternative groups        : ${#REQUIRED_ALTERNATIVES[@]}"
  echo
}

missing_count=0

print_header

# Check single required signoffs
echo "Checking required signoff files..."
for rel in "${REQUIRED_SINGLE[@]}"; do
  if exists "$rel"; then
    printf "  [OK]    %s\n" "$rel"
  else
    printf "  [MISSING] %s\n" "$rel"
    missing_count=$((missing_count+1))
  fi
done

# Check alternative groups
echo
echo "Checking alternative signoff groups (any one alternative satisfies requirement)..."
for entry in "${REQUIRED_ALTERNATIVES[@]}"; do
  IFS=':::' read -r desc rest <<< "$entry"
  # rest contains the paths joined by |||
  IFS='|||' read -r -a alts <<< "$rest"
  found_any=0
  for alt in "${alts[@]}"; do
    if exists "$alt"; then
      printf "  [OK]    %s (satisfied by %s)\n" "$desc" "$alt"
      found_any=1
      break
    fi
  done
  if [ "$found_any" -eq 0 ]; then
    printf "  [MISSING] %s (none of the alternatives present)\n" "$desc"
    printf "            alternatives are:\n"
    for alt in "${alts[@]}"; do
      printf "              - %s\n" "$alt"
    done
    missing_count=$((missing_count+1))
  fi
done

print_result

if [ "$missing_count" -gt 0 ]; then
  echo "ERROR: ${missing_count} required signoff item(s) missing."
  echo
  echo "Notes:"
  echo " - Signoff files are typically small text files placed under <module>/signoffs/*.sig"
  echo " - They should be added by the approver (Security Engineer, Finance Lead, Ryan, etc.)"
  echo " - For development/testing you may create placeholder files, but final signoffs must be produced by approvers."
  exit 2
fi

echo "All required signoff files are present."
exit 0

