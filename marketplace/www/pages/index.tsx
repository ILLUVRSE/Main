import Head from "next/head";
import { GetServerSideProps } from "next";
import { useMemo, useState } from "react";
import { ModelCard } from "@/components/ModelCard";
import { PreviewPanel } from "@/components/PreviewPanel";
import { fetchCatalog } from "@/lib/api";
import { CatalogResponse, MarketplaceModel } from "@/lib/types";
import { useCart } from "@/context/cart";

interface CatalogPageProps {
  initialCatalog: CatalogResponse;
}

const PAGE_SIZE = 9;

export default function CatalogPage({ initialCatalog }: CatalogPageProps) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [previewModel, setPreviewModel] = useState<MarketplaceModel | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const { addItem, totalItems } = useCart();

  const filtered = useMemo(() => {
    return initialCatalog.items.filter((model) => {
      const query = search.toLowerCase();
      const matchesSearch = query
        ? model.title.toLowerCase().includes(query) ||
          model.tags.join(" ").toLowerCase().includes(query) ||
          model.owner.toLowerCase().includes(query)
        : true;
      const matchesCategory = category ? model.categories.includes(category) : true;
      return matchesSearch && matchesCategory;
    });
  }, [initialCatalog.items, search, category]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const categories = ["All", ...initialCatalog.categories];

  function handleAddToCart(model: MarketplaceModel) {
    const version = model.versions[0];
    addItem({
      skuId: model.id,
      slug: model.slug,
      modelTitle: model.title,
      price: model.price,
      currency: model.currency,
      versionId: version?.id ?? `${model.id}:latest`,
      versionLabel: version?.label ?? "Latest",
      deliveryMode: "marketplace_managed",
    });
  }

  function handleSearchChange(event: React.ChangeEvent<HTMLInputElement>) {
    setSearch(event.currentTarget.value);
    setPage(1);
  }

  function handleCategoryChange(nextCategory: string) {
    setCategory(nextCategory === "All" ? null : nextCategory);
    setPage(1);
  }

  return (
    <>
      <Head>
        <title>ILLUVRSE Marketplace</title>
      </Head>
      <main className="mx-auto max-w-6xl px-6 py-10">
        <header className="flex flex-col gap-6 border-b border-white/10 pb-8">
          <div className="flex flex-col gap-2 text-sm uppercase tracking-[0.3em] text-brand-accent">
            <span>Illuvrse Marketplace</span>
            <span className="text-xs text-slate-400">Hugging Face × Amazon for trusted manifests</span>
          </div>
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <h1 className="text-4xl font-semibold text-white">
              Explore manifests, sandboxes, pricing, and provenance
            </h1>
            <div className="rounded-full border border-white/10 px-4 py-1 text-sm text-slate-300">
              Cart • {totalItems} item{totalItems === 1 ? "" : "s"}
            </div>
          </div>
          <div className="flex flex-col gap-4 md:flex-row">
            <label className="flex flex-1 items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
              <svg viewBox="0 0 24 24" className="h-5 w-5 text-slate-400" aria-hidden>
                <path
                  d="M11 4a7 7 0 0 1 5.59 11.19l3.6 3.58-1.42 1.42-3.58-3.6A7 7 0 1 1 11 4Zm0 2a5 5 0 1 0 0 10 5 5 0 0 0 0-10Z"
                  fill="currentColor"
                />
              </svg>
              <input
                type="search"
                value={search}
                onChange={handleSearchChange}
                placeholder="Search by title, SKU, owner, or tags"
                className="flex-1 bg-transparent text-base text-white placeholder:text-slate-500 focus:outline-none"
                aria-label="Search catalog"
              />
            </label>
            <div className="flex flex-wrap gap-2">
              {categories.map((entry) => {
                const isActive = entry === "All" ? category === null : category === entry;
                return (
                  <button
                    key={entry}
                    type="button"
                    onClick={() => handleCategoryChange(entry)}
                    className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                      isActive
                        ? "bg-brand text-white shadow-lg shadow-brand/30"
                        : "border border-white/10 text-slate-300 hover:border-brand"
                    }`}
                    aria-pressed={isActive}
                  >
                    {entry}
                  </button>
                );
              })}
            </div>
          </div>
        </header>

        <section className="mt-10">
          {paginated.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-white/10 p-10 text-center text-slate-300">
              No models found. Adjust the filters or try a different query.
            </div>
          ) : (
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {paginated.map((model) => (
                <ModelCard
                  key={model.id}
                  model={model}
                  onAddToCart={handleAddToCart}
                  onPreview={(selected) => {
                    setPreviewModel(selected);
                    setIsPreviewOpen(true);
                  }}
                />
              ))}
            </div>
          )}
        </section>

        <footer className="mt-12 flex items-center justify-between text-sm text-slate-400">
          <span>
            Showing {(page - 1) * PAGE_SIZE + 1}-{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}
          </span>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setPage((prev) => Math.max(1, prev - 1))}
              disabled={page === 1}
              className="rounded-full border border-white/10 px-4 py-2 text-white disabled:opacity-40"
            >
              Previous
            </button>
            <span className="rounded-full border border-white/10 px-4 py-2">
              Page {page} / {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
              disabled={page === totalPages}
              className="rounded-full border border-white/10 px-4 py-2 text-white disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </footer>
        {previewModel && (
          <PreviewPanel
            model={previewModel}
            open={isPreviewOpen}
            onClose={() => setIsPreviewOpen(false)}
            versionId={previewModel.versions[0]?.id}
          />
        )}
      </main>
    </>
  );
}

export const getServerSideProps: GetServerSideProps<CatalogPageProps> = async () => {
  const initialCatalog = await fetchCatalog({ pageSize: 30 });
  return {
    props: {
      initialCatalog,
    },
  };
};
