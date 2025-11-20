import Image from "next/image";
import Link from "next/link";
import { MarketplaceModel } from "@/lib/types";

interface ModelCardProps {
  model: MarketplaceModel;
  onPreview?: (model: MarketplaceModel) => void;
  onAddToCart: (model: MarketplaceModel) => void;
}

export function ModelCard({ model, onPreview, onAddToCart }: ModelCardProps) {
  const primaryVersion = model.versions[0];
  const priceLabel = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: model.currency,
    maximumFractionDigits: 0,
  }).format(model.price);

  return (
    <article className="flex flex-col overflow-hidden rounded-3xl border border-white/10 bg-slate-900/50 shadow-xl shadow-black/40 transition hover:border-brand hover:shadow-brand/30">
      <Link href={`/sku/${model.slug}`} className="relative block h-56 w-full">
        <Image
          src={model.thumbnailUrl}
          alt={model.title}
          fill
          sizes="(max-width: 768px) 100vw, 33vw"
          className="object-cover"
        />
        {model.verified && (
          <span className="absolute left-4 top-4 inline-flex items-center gap-1 rounded-full bg-emerald-500/90 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-emerald-950">
            <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" aria-hidden>
              <path
                fill="currentColor"
                d="m8.5 13.5 6-6-1.4-1.4L8.5 10.7 6.9 9.1 5.5 10.5l3 3Z"
              />
            </svg>
            Verified
          </span>
        )}
      </Link>
      <div className="flex flex-1 flex-col gap-5 p-6">
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between text-xs uppercase tracking-wide text-slate-400">
            <span>{model.owner}</span>
            <span>{model.categories.join(" · ")}</span>
          </div>
          <Link href={`/sku/${model.slug}`} className="text-2xl font-semibold text-white hover:text-brand">
            {model.title}
          </Link>
          <p className="text-sm text-slate-300">{model.shortDescription}</p>
        </div>
        <div className="flex items-center justify-between text-sm text-slate-400">
          <div className="flex items-center gap-1" aria-label={`Rated ${model.rating} by ${model.ratingCount} buyers`}>
            {Array.from({ length: 5 }).map((_, idx) => (
              <svg key={idx} viewBox="0 0 20 20" className="h-4 w-4" aria-hidden>
                <path
                  d="m10 15.3-5.3 3 1-5.9-4.3-4.2 6-0.9L10 2l2.6 5.3 6 0.9-4.3 4.2 1 5.9z"
                  fill={idx < Math.round(model.rating) ? "currentColor" : "none"}
                  stroke="currentColor"
                  className={idx < Math.round(model.rating) ? "text-amber-400" : "text-slate-500"}
                />
              </svg>
            ))}
            <span>{model.rating.toFixed(1)}</span>
          </div>
          <span>{model.ratingCount.toLocaleString()} reviews</span>
        </div>
        <ul className="flex flex-wrap gap-2 text-xs text-slate-300">
          {model.tags.map((tag) => (
            <li key={tag} className="rounded-full border border-white/10 px-3 py-1">
              {tag}
            </li>
          ))}
        </ul>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-slate-400">Starting at</p>
            <p className="text-3xl font-semibold text-white">{priceLabel}</p>
            {primaryVersion && (
              <p className="text-xs text-slate-500">Includes {primaryVersion.label}</p>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              className="rounded-full border border-white/20 px-4 py-2 text-sm font-medium text-white transition hover:border-brand hover:text-brand"
              disabled={!onPreview}
              onClick={() => onPreview?.(model)}
            >
              Preview
            </button>
            <button
              type="button"
              className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500"
              onClick={() => onAddToCart(model)}
            >
              Add to cart
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}
