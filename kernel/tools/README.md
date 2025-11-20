# Kernel tools

`signers.json` is the canonical registry consumed by `kernel/tools/audit-verify.js`. Populate it with **public** keys only:

- Never check in private keys; export public keys from your KMS or signing proxy and paste their PEM values.
- Keep the metadata (`signer_kid`, `algorithm`, and `description`) in sync with your real signing infrastructure so auditors know which key was used.
- Update the `deployedAt` timestamp to the real activation time whenever you rotate keys.

You can validate the JSON structure locally with:

```bash
node kernel/tools/audit-verify.js -s kernel/tools/signers.json || true
```
