import dotenv from 'dotenv';
dotenv.config();
const fallback = (primary, legacy, defaultValue) => primary ?? legacy ?? defaultValue;
export const resolveConfig = (overrides = {}) => {
    const port = Number.parseInt(fallback(process.env.ARTIFACT_PUBLISHER_PORT, process.env.REPOWRITER_PORT, '6137'), 10);
    const dbUrl = fallback(process.env.ARTIFACT_PUBLISHER_DB_URL, process.env.REPOWRITER_DB_URL, 'postgres://postgres:postgrespw@127.0.0.1:5433/artifact_publisher');
    const kernelBaseUrl = fallback(process.env.ARTIFACT_PUBLISHER_KERNEL_URL, process.env.REPOWRITER_KERNEL_URL, 'http://127.0.0.1:6050');
    const proofSecret = fallback(process.env.ARTIFACT_PUBLISHER_PROOF_SECRET, process.env.REPOWRITER_PROOF_SECRET, 'artifact-publisher-proof-secret');
    const deliveryKey = fallback(process.env.ARTIFACT_PUBLISHER_DELIVERY_KEY, process.env.REPOWRITER_DELIVERY_KEY, 'artifact-publisher-delivery-key');
    const sandboxSeed = fallback(process.env.ARTIFACT_PUBLISHER_SANDBOX_SEED, process.env.REPOWRITER_SANDBOX_SEED, 'artifact-sandbox-seed');
    const deterministicSalt = fallback(process.env.ARTIFACT_PUBLISHER_DETERMINISTIC_SALT, process.env.REPOWRITER_DETERMINISTIC_SALT, 'artifact-deterministic-salt');
    return {
        port,
        dbUrl,
        kernel: {
            baseUrl: overrides.kernel?.baseUrl ?? kernelBaseUrl,
            multisigThreshold: overrides.kernel?.multisigThreshold ?? 2,
        },
        stripePublicKey: overrides.stripePublicKey ??
            fallback(process.env.ARTIFACT_PUBLISHER_STRIPE_KEY, process.env.REPOWRITER_STRIPE_KEY, 'pk_test_artifact'),
        financeLedgerId: overrides.financeLedgerId ??
            fallback(process.env.ARTIFACT_PUBLISHER_LEDGER_ID, process.env.REPOWRITER_LEDGER_ID, 'ledger-main'),
        proofSecret: overrides.proofSecret ?? proofSecret,
        deliveryKey: overrides.deliveryKey ?? deliveryKey,
        sandboxSeed: overrides.sandboxSeed ?? sandboxSeed,
        deterministicSalt: overrides.deterministicSalt ?? deterministicSalt,
    };
};
