# kernel/ci — guidance

This folder contains CI helper scripts used by the repository workflows.

## Signing proxy / KMS enforcement in CI
`kernel/ci/require_kms_check.sh` fails fast whenever a configured signing proxy or KMS endpoint is unreachable. The script accepts:

- `SIGNING_PROXY_URL`: probed via `SIGNING_PROXY_URL/health`.
- `KMS_ENDPOINT`: probed as-is, then `${KMS_ENDPOINT}/health` if the first probe fails.
- Optional `REQUIRE_SIGNING_PROXY` / `REQUIRE_KMS`: when set to `true`, the script errors immediately if the matching URL is missing.

Typical usage in GitHub Actions:

```yaml
- name: Signing / KMS check
  env:
    SIGNING_PROXY_URL: ${{ secrets.SIGNING_PROXY_URL || '' }}
    KMS_ENDPOINT: ${{ secrets.KMS_ENDPOINT || '' }}
    REQUIRE_SIGNING_PROXY: ${{ secrets.REQUIRE_SIGNING_PROXY || 'false' }}
    REQUIRE_KMS: ${{ secrets.REQUIRE_KMS || 'false' }}
  run: ./kernel/ci/require_kms_check.sh
```

To enforce the guardrail on protected branches, add repository/organization secrets for `SIGNING_PROXY_URL` and/or `KMS_ENDPOINT` (pointing to the real health endpoints). The script exits `0` as soon as a reachable endpoint is detected, exits `>0` when the health probe fails, and exits `1` when no endpoint is configured (so you notice that prod guards are missing).

## How to add the secret
1. Go to the repository on GitHub → **Settings** → **Secrets and variables** → **Actions**.  
2. Click **New repository secret**.  
3. Name: `KMS_ENDPOINT`  
4. Value: `https://kms.example/` (or your real KMS URL)  
5. Click **Add secret**.

## Re-run CI
After adding the secret or pushing changes:
- Open **Actions → CI — Container + E2E** for the latest commit, click the run and **Re-run jobs → Re-run failed jobs**.
