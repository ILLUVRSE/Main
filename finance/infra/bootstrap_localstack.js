const { KMSClient, CreateKeyCommand, ListAliasesCommand, CreateAliasCommand } = require('@aws-sdk/client-kms');

async function ensureKmsKey() {
  const region = process.env.AWS_REGION ?? 'us-east-1';
  const endpoint = process.env.KMS_ENDPOINT;
  const aliasName = process.env.KMS_KEY_ALIAS ?? 'alias/finance-proof';
  const client = new KMSClient({ region, endpoint });
  const existing = await client.send(new ListAliasesCommand({}));
  const alias = existing.Aliases?.find((entry) => entry.AliasName === aliasName && entry.TargetKeyId);
  if (alias?.TargetKeyId) {
    return alias.TargetKeyId;
  }
  const key = await client.send(
    new CreateKeyCommand({
      Description: 'Finance proof signing key',
      KeyUsage: 'SIGN_VERIFY',
      KeySpec: 'RSA_2048',
      Origin: 'AWS_KMS',
    })
  );
  if (!key.KeyMetadata?.KeyId) {
    throw new Error('Failed to create KMS key');
  }
  await client.send(
    new CreateAliasCommand({
      AliasName: aliasName,
      TargetKeyId: key.KeyMetadata.KeyId,
    })
  );
  return key.KeyMetadata.KeyId;
}

module.exports = { ensureKmsKey };

if (require.main === module) {
  ensureKmsKey()
    .then((keyId) => console.log(keyId))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
