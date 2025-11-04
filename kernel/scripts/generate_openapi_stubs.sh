#!/usr/bin/env bash
# generate_openapi_stubs.sh
# Usage:
#   ./generate_openapi_stubs.sh                 # uses kernel/api/openapi.yaml -> kernel/api/gen
#   ./generate_openapi_stubs.sh <input> <out>  # custom input and output
#
# Notes:
# - This script uses the Docker image openapitools/openapi-generator-cli.
# - You can install openapi-generator locally instead, then replace the docker call.
# - The generator used below is "go" (server + models). Adjust -g if you prefer other languages.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
INPUT="${1:-kernel/api/openapi.yaml}"
OUTPUT="${2:-kernel/api/gen}"
GENERATOR="${3:-go}"  # change to "typescript-express" or others if desired

echo "OpenAPI spec: $INPUT"
echo "Output dir: $OUTPUT"
echo "Generator: $GENERATOR"

# Ensure input exists
if [ ! -f "$ROOT_DIR/$INPUT" ]; then
  echo "ERROR: OpenAPI spec not found: $ROOT_DIR/$INPUT"
  exit 1
fi

# Create output dir
mkdir -p "$ROOT_DIR/$OUTPUT"

# Run docker-based openapi-generator
echo "Running openapi-generator (docker)..."
docker run --rm -v "${ROOT_DIR}:/local" openapitools/openapi-generator-cli:v6.6.0 generate \
  -i "/local/$INPUT" \
  -g "$GENERATOR" \
  -o "/local/$OUTPUT" \
  --additional-properties=packageName=gen,goModule=github.com/ILLUVRSE/Main/kernel/api/gen

echo "OpenAPI stubs generated to: $ROOT_DIR/$OUTPUT"
echo "Review and commit generated files if desired."

