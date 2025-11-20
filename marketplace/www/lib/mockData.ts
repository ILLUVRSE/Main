import { CatalogResponse, MarketplaceModel, OrderRecord } from "./types";

const now = new Date();

export const demoModels: MarketplaceModel[] = [
  {
    id: "mdl_synthetic_guardian",
    slug: "synthetic-guardian",
    title: "Synthetic Guardian V3",
    owner: "SentinelNet Labs",
    shortDescription: "Real-time threat detection tuned for high-throughput inference across air-gapped clusters.",
    longDescription:
      "Synthetic Guardian pairs SentinelNet's zero-trust telemetry graph with Illuvrse's streaming mesh to block kill chains before lateral movement begins.",
    price: 1499,
    currency: "USD",
    rating: 4.9,
    ratingCount: 842,
    tags: ["security", "monitoring", "governance"],
    thumbnailUrl: "https://images.unsplash.com/photo-1485827404703-89b55fcc595e",
    categories: ["Security", "Ops"],
    updatedAt: now.toISOString(),
    verified: true,
    featured: true,
    latestReleaseNotes: "Hydra scoring, kernel panic replay support, and SOC 2 attestations added.",
    versions: [
      {
        id: "mdl_synthetic_guardian:v3_2",
        label: "v3.2 Hydra",
        sha: "9c4b6147",
        publishedAt: "2025-01-11T12:00:00.000Z",
        latencyMs: 620,
        throughputTokensPerSecond: 1600,
        price: 1499,
        currency: "USD",
        supportsStreaming: true,
        changelog: "Hydra heuristics, MI300X tuning, phi-safe guardrails",
      },
      {
        id: "mdl_synthetic_guardian:v3_1",
        label: "v3.1",
        sha: "47b39318",
        publishedAt: "2024-11-02T12:00:00.000Z",
        latencyMs: 700,
        throughputTokensPerSecond: 1200,
        price: 1299,
        currency: "USD",
        supportsStreaming: true,
        changelog: "SOC posture patch bump",
      },
    ],
    examples: [
      {
        id: "ex_guardian_1",
        input: "Cluster telemetry from validator 8",
        output: "Flagged anomalous RPC fan-out, suggested isolation",
        createdAt: now.toISOString(),
      },
      {
        id: "ex_guardian_2",
        input: "Ingress log sample",
        output: "Marked suspicious L7 pattern, auto-opened ticket",
        createdAt: now.toISOString(),
      },
    ],
    trustSignals: [
      {
        id: "ts_guardian_iso",
        label: "ISO 27001",
        description: "Control families 5-18 validated by ForgeTrust",
        type: "compliance",
      },
      {
        id: "ts_guardian_soc",
        label: "SOC 2 Type II",
        description: "24 month attestation with zero exceptions",
        type: "compliance",
      },
    ],
  },
  {
    id: "mdl_atlas_foundry",
    slug: "atlas-foundry",
    title: "Atlas Foundry XL",
    owner: "Atlas Compute",
    shortDescription: "Multi-turn reasoning stack with curated scientific corpora.",
    longDescription:
      "Atlas Foundry powers research copilots that demand verifiable citations, version pinning, and cost controls.",
    price: 999,
    currency: "USD",
    rating: 4.7,
    ratingCount: 612,
    tags: ["research", "science", "citations"],
    thumbnailUrl: "https://images.unsplash.com/photo-1489515217757-5fd1be406fef",
    categories: ["Research", "Productivity"],
    updatedAt: now.toISOString(),
    verified: true,
    featured: false,
    latestReleaseNotes: "Added causal attention kernels and vector commit proofs.",
    versions: [
      {
        id: "mdl_atlas_foundry:v2_4",
        label: "v2.4",
        sha: "c7f4f1b9",
        publishedAt: "2024-12-12T09:00:00.000Z",
        latencyMs: 850,
        throughputTokensPerSecond: 900,
        price: 999,
        currency: "USD",
        supportsStreaming: true,
        changelog: "Causal attention kernels",
      },
      {
        id: "mdl_atlas_foundry:v2_1",
        label: "v2.1",
        sha: "a6d13877",
        publishedAt: "2024-08-08T09:00:00.000Z",
        latencyMs: 930,
        throughputTokensPerSecond: 780,
        price: 799,
        currency: "USD",
        supportsStreaming: false,
        changelog: "Grounding pass refresh",
      },
    ],
    examples: [
      {
        id: "ex_atlas_1",
        input: "Derive pressure equation for hab modules",
        output: "P = nRT/V with microgravity correction, cites NASA-4547",
        createdAt: now.toISOString(),
      },
    ],
    trustSignals: [
      {
        id: "ts_atlas_gov",
        label: "GovCloud ready",
        description: "FedRAMP moderate alignment",
        type: "security",
      },
    ],
  },
  {
    id: "mdl_muse_cartographer",
    slug: "muse-cartographer",
    title: "Muse Cartographer",
    owner: "Illuvrse Studios",
    shortDescription: "Creative world-building model with streaming viewport previews.",
    longDescription:
      "Muse Cartographer is tuned for immersive lore, multi-modal prompts, and collaborative editing sessions.",
    price: 449,
    currency: "USD",
    rating: 4.6,
    ratingCount: 421,
    tags: ["creative", "lore", "sandbox"],
    thumbnailUrl: "https://images.unsplash.com/photo-1498050108023-c5249f4df085",
    categories: ["Creative", "Media"],
    updatedAt: now.toISOString(),
    verified: false,
    featured: true,
    latestReleaseNotes: "Added streaming storyboard previews.",
    versions: [
      {
        id: "mdl_muse_cartographer:v1_8",
        label: "v1.8",
        sha: "2c3f91de",
        publishedAt: "2024-10-02T14:00:00.000Z",
        latencyMs: 520,
        throughputTokensPerSecond: 2100,
        price: 449,
        currency: "USD",
        supportsStreaming: true,
        changelog: "Storyboard streaming",
      },
    ],
    examples: [
      {
        id: "ex_muse_1",
        input: "Describe an Illuvium spire",
        output: "A ribbon of aurora glass climbing the crater rim...",
        createdAt: now.toISOString(),
      },
    ],
    trustSignals: [
      {
        id: "ts_muse_chain",
        label: "Chain-of-custody",
        description: "Signed artifact trail published to S3 Object Lock tier",
        type: "audit",
      },
    ],
  },
];

export const demoCatalog: CatalogResponse = {
  items: demoModels,
  total: demoModels.length,
  page: 1,
  pageSize: demoModels.length,
  categories: Array.from(new Set(demoModels.flatMap((model) => model.categories))).sort(),
};

export const demoOrders: Record<string, OrderRecord> = {
  ord_demo_001: {
    id: "ord_demo_001",
    status: "delivered",
    createdAt: "2025-01-05T09:45:00.000Z",
    updatedAt: "2025-01-05T10:10:00.000Z",
    items: [
      {
        skuId: "mdl_synthetic_guardian",
        slug: "synthetic-guardian",
        modelTitle: "Synthetic Guardian V3",
        versionLabel: "v3.2 Hydra",
        price: 1499,
        currency: "USD",
      },
    ],
    total: 1499,
    currency: "USD",
    license: {
      name: "SentinelNet Guardian Evaluation License",
      body: "Customer may deploy Guardian inference endpoints for internal SOC workloads only.",
      effectiveAt: "2025-01-05T09:45:00.000Z",
      expiresAt: "2025-02-05T09:45:00.000Z",
    },
    delivery: {
      mode: "marketplace_managed",
      keyMetadata: {
        keyType: "rsa",
        format: "pem",
        fingerprint: "AA:CD:42:91",
      },
      fulfillmentEta: "2025-01-05T12:00:00.000Z",
    },
    proof: {
      id: "proof_demo_001",
      createdAt: "2025-01-05T10:05:00.000Z",
      evidenceHash: "0x514b97d1d1",
      merkleRoot: "0x9fa8c6b77d",
      notarizationUrl: "https://explorer.illuvrse.ai/notary/proof_demo_001",
      courierSignature: "SentinelNet Vault Cluster",
    },
  },
};

export function findDemoModelBySlug(slug: string) {
  return demoModels.find((model) => model.slug === slug);
}

export function getDemoOrderById(id: string) {
  return demoOrders[id];
}
