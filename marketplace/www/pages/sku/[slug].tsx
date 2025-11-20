import Head from "next/head";
import Image from "next/image";
import Link from "next/link";
import { GetServerSideProps } from "next";
import { useMemo, useState } from "react";
import { useRouter } from "next/router";
import { fetchSkuBySlug } from "@/lib/api";
import { DeliveryMode, MarketplaceModel } from "@/lib/types";
import { useCart } from "@/context/cart";
import { PreviewPanel } from "@/components/PreviewPanel";
import { BuyWidget } from "@/components/BuyWidget";

interface SkuPageProps {
  model: MarketplaceModel;
}

const tabs = [
  { id: "overview", label: "Overview" },
  { id: "examples", label: "Examples" },
  { id: "versions", label: "Versions" },
] as const;

type TabId = (typeof tabs)[number]["id"];

export default function SkuDetailPage({ model }: SkuPageProps) {
  const [selectedVersionId, setSelectedVersionId] = useState(model.versions[0]?.id ?? "");
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const { addItem } = useCart();
  const router = useRouter();

  const selectedVersion = useMemo(
    () => model.versions.find((version) => version.id === selectedVersionId) ?? model.versions[0],
    [model.versions, selectedVersionId]
  );

  function addToCart({ deliveryMode, pem }: { deliveryMode: DeliveryMode; pem?: string }) {
    if (!selectedVersion) return;
    if (deliveryMode === "buyer_managed" && !pem) {
      throw new Error("Buyer-managed deliveries require a PEM public key.");
    }
    addItem({
      skuId: model.id,
      slug: model.slug,
      modelTitle: model.title,
      price: selectedVersion.price,
      currency: selectedVersion.currency,
      versionId: selectedVersion.id,
      versionLabel: selectedVersion.label,
      deliveryMode,
      buyerKeyPem: pem,
    });
  }

  function handleCheckout(options: { deliveryMode: DeliveryMode; pem?: string }) {
    addToCart(options);
    router.push(`/checkout?sku=${model.slug}&version=${selectedVersion?.id}`);
  }

  return (
    <>
      <Head>
        <title>{model.title} · ILLUVRSE Marketplace</title>
      </Head>
      <main className="mx-auto max-w-6xl px-6 py-10">
        <nav className="text-sm text-slate-400">
          <Link href="/" className="hover:text-white">
            Catalog
          </Link>
          <span className="mx-2">/</span>
          <span className="text-white">{model.title}</span>
        </nav>
        <div className="mt-6 grid gap-10 lg:grid-cols-[2fr_1fr]">
          <section className="space-y-8">
            <div className="overflow-hidden rounded-3xl border border-white/10">
              <div className="relative h-80 w-full">
                <Image
                  src={model.thumbnailUrl}
                  alt={model.title}
                  fill
                  sizes="(max-width: 1024px) 100vw, 66vw"
                  className="object-cover"
                  priority
                />
              </div>
              <div className="flex flex-col gap-4 border-t border-white/10 bg-slate-950/60 p-6 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-brand-accent">{model.owner}</p>
                  <h1 className="mt-2 text-4xl font-semibold text-white">{model.title}</h1>
                  <p className="text-sm text-slate-400">{model.shortDescription}</p>
                </div>
                <div className="flex gap-3 text-sm text-slate-300">
                  <div>
                    <p className="text-xs uppercase text-slate-500">Rating</p>
                    <p className="text-lg font-semibold text-white">{model.rating.toFixed(1)}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase text-slate-500">Updated</p>
                    <p>{new Date(model.updatedAt).toLocaleDateString()}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase text-slate-500">Reviews</p>
                    <p>{model.ratingCount.toLocaleString()}</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => setIsPreviewOpen(true)}
                className="rounded-full border border-white/20 px-5 py-2 text-sm font-semibold text-white hover:border-brand"
              >
                Preview sandbox
              </button>
              <Link
                href="#versions"
                className="rounded-full border border-white/10 px-5 py-2 text-sm font-semibold text-slate-200 hover:border-brand"
              >
                Versions
              </Link>
            </div>

            <div>
              <div className="flex flex-wrap gap-3 border-b border-white/10">
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                      activeTab === tab.id
                        ? "bg-brand text-white"
                        : "text-slate-300 hover:text-white"
                    }`}
                    aria-current={activeTab === tab.id ? "page" : undefined}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              <div className="mt-6 space-y-4 text-slate-200">
                {activeTab === "overview" && (
                  <div className="space-y-4">
                    <p className="text-lg text-white">{model.longDescription}</p>
                    <div className="grid gap-4 md:grid-cols-2">
                      {model.trustSignals.map((signal) => (
                        <div key={signal.id} className="rounded-2xl border border-white/10 p-4">
                          <p className="text-sm uppercase tracking-[0.2em] text-brand-accent">{signal.type}</p>
                          <p className="text-xl font-semibold text-white">{signal.label}</p>
                          <p className="text-sm text-slate-400">{signal.description}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {activeTab === "examples" && (
                  <ul className="space-y-4">
                    {model.examples.map((example) => (
                      <li key={example.id} className="rounded-3xl border border-white/10 bg-black/40 p-4">
                        <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Prompt</p>
                        <p className="text-white">{example.input}</p>
                        <p className="mt-3 text-xs uppercase tracking-[0.3em] text-slate-400">Output</p>
                        <p className="text-emerald-200">{example.output}</p>
                      </li>
                    ))}
                  </ul>
                )}
                {activeTab === "versions" && (
                  <table id="versions" className="w-full text-left text-sm text-slate-200">
                    <thead className="text-xs uppercase tracking-[0.3em] text-slate-400">
                      <tr>
                        <th className="pb-3">Version</th>
                        <th className="pb-3">Latency</th>
                        <th className="pb-3">Tokens/s</th>
                        <th className="pb-3">Price</th>
                        <th className="pb-3">Published</th>
                      </tr>
                    </thead>
                    <tbody>
                      {model.versions.map((version) => (
                        <tr key={version.id} className="border-t border-white/10">
                          <td className="py-3 font-semibold text-white">{version.label}</td>
                          <td>{version.latencyMs} ms</td>
                          <td>{version.throughputTokensPerSecond.toLocaleString()}</td>
                          <td>
                            {new Intl.NumberFormat("en-US", {
                              style: "currency",
                              currency: version.currency,
                              maximumFractionDigits: 0,
                            }).format(version.price)}
                          </td>
                          <td>{new Date(version.publishedAt).toLocaleDateString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </section>

          <BuyWidget
            model={model}
            selectedVersionId={selectedVersion?.id ?? model.versions[0]?.id ?? ""}
            onSelectVersion={setSelectedVersionId}
            onAddToCart={(opts) => addToCart(opts)}
            onCheckout={(opts) => handleCheckout(opts)}
          />
        </div>
      </main>
      <PreviewPanel
        model={model}
        open={isPreviewOpen}
        onClose={() => setIsPreviewOpen(false)}
        versionId={selectedVersion?.id}
      />
    </>
  );
}

export const getServerSideProps: GetServerSideProps<SkuPageProps> = async (context) => {
  const slug = context.params?.slug;
  if (typeof slug !== "string") {
    return { notFound: true };
  }
  const model = await fetchSkuBySlug(slug);
  if (!model) {
    return { notFound: true };
  }
  return {
    props: {
      model,
    },
  };
};
