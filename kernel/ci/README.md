# kernel/ci — guidance

This folder contains CI helper scripts used by the repository workflows.

## KMS enforcement in CI
The CI workflow will run `kernel/ci/require_kms_check.sh` for pushes to `main` when a repository secret named `KMS_ENDPOINT` is present.

- To enforce KMS in CI (recommended for production), add a GitHub Actions repository secret:
  - Name: `KMS_ENDPOINT`
  - Value: the URL of your KMS signing proxy (e.g. `https://kms.example/`)

- If `KMS_ENDPOINT` is not set, CI will skip the REQUIRE_KMS enforcement step (to avoid failing CI during development).

## How to add the secret
1. Go to the repository on GitHub → **Settings** → **Secrets and variables** → **Actions**.  
2. Click **New repository secret**.  
3. Name: `KMS_ENDPOINT`  
4. Value: `https://kms.example/` (or your real KMS URL)  
5. Click **Add secret**.

## Re-run CI
After adding the secret or pushing changes:
- Open **Actions → CI — Container + E2E** for the latest commit, click the run and **Re-run jobs → Re-run failed jobs**.

