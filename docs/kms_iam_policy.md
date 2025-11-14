## KMS IAM Policy and Operational Notes

The IAM policy below is the minimum required for services that sign audit digests or fetch the matching public key. Replace `${REGION}`, `${ACCOUNT_ID}`, and `${KEY_ID}` with the dedicated audit KMS key ARN. Keep the allowed signing algorithms in sync with your key spec (example shows RSA 4096 for audit digests).

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AuditDigestSigning",
      "Effect": "Allow",
      "Action": [
        "kms:Sign",
        "kms:GenerateMac",
        "kms:GetPublicKey",
        "kms:DescribeKey"
      ],
      "Resource": "arn:aws:kms:${REGION}:${ACCOUNT_ID}:key/${KEY_ID}",
      "Condition": {
        "ForAllValues:StringEquals": {
          "kms:SigningAlgorithm": [
            "RSASSA_PSS_SHA_384",
            "RSASSA_PSS_SHA_512"
          ]
        }
      }
    }
  ]
}
```

Attach the policy to the execution role assumed by the signing service (for example `illuvrse-audit-signer`). Use either an inline policy (fastest for single consumer) or an AWS-managed customer policy attached to multiple roles if several lambdas or pods need signing rights. After attachment, validate with `aws sts get-caller-identity` (to confirm the role) followed by a dry-run `aws kms sign --dry-run` call to catch permission issues before deployment.

Key rotation with minimal downtime: (1) create a new asymmetric KMS key with the same spec as the retiring key; (2) immediately export and publish the new public key so verifiers can trust it; (3) update infrastructure secrets or environment variables (`AUDIT_KMS_KEY_ARN`) and redeploy signing workloads against the new ARN; (4) monitor digest verification, then disable the old key once no consumers report failures.

Exporting the public key for `kernel/tools/signers.json`:

```bash
AUDIT_KEY_ARN="arn:aws:kms:us-east-1:123456789012:key/abcd-1234"
aws kms get-public-key --key-id "$AUDIT_KEY_ARN" \
  --query PublicKey --output text | base64 --decode > /tmp/audit_key.der
openssl rsa -pubin -inform DER -in /tmp/audit_key.der -outform PEM \
  -out /tmp/audit_key.pem
cat /tmp/audit_key.pem
```

Paste the PEM block into `kernel/tools/signers.json`, bump the version field, and commit alongside any environment variable flips so the ingest and verification pipelines stay in lockstep.
