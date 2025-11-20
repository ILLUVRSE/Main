import { useEffect, useState } from "react";
import { DeliveryMode, MarketplaceModel } from "@/lib/types";
import { validatePublicKeyPem } from "@/lib/pem";

interface BuyWidgetProps {
  model: MarketplaceModel;
  selectedVersionId: string;
  onSelectVersion: (versionId: string) => void;
  onAddToCart: (options: { deliveryMode: DeliveryMode; pem?: string }) => void;
  onCheckout?: (options: { deliveryMode: DeliveryMode; pem?: string }) => void;
}

const deliveryOptions: { label: string; value: DeliveryMode; description: string }[] = [
  {
    label: "Marketplace managed",
    value: "marketplace_managed",
    description: "ILLUVRSE delivers encrypted artifacts with custody proofs",
  },
  {
    label: "Buyer managed",
    value: "buyer_managed",
    description: "Bring your own delivery rail (PEM support coming in step 4)",
  },
];

export function BuyWidget({ model, selectedVersionId, onSelectVersion, onAddToCart, onCheckout }: BuyWidgetProps) {
  const [deliveryMode, setDeliveryMode] = useState<DeliveryMode>("marketplace_managed");
  const [pem, setPem] = useState("");
  const [pemTouched, setPemTouched] = useState(false);
  const selectedVersion = model.versions.find((version) => version.id === selectedVersionId) ?? model.versions[0];
  const formattedPrice = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: selectedVersion?.currency ?? model.currency,
    maximumFractionDigits: 0,
  }).format(selectedVersion?.price ?? model.price);

  const isBuyerManaged = deliveryMode === "buyer_managed";
  const pemValid = !isBuyerManaged || validatePublicKeyPem(pem);

  useEffect(() => {
    if (deliveryMode === "marketplace_managed") {
      setPemTouched(false);
    }
  }, [deliveryMode]);

  function handleAction(callback?: (options: { deliveryMode: DeliveryMode; pem?: string }) => void) {
    if (!callback) return;
    const trimmedPem = pem.trim();
    callback({
      deliveryMode,
      pem: isBuyerManaged ? trimmedPem : undefined,
    });
  }

  return (
    <aside className="rounded-3xl border border-white/10 bg-slate-950/70 p-6 shadow-2xl shadow-black/40">
      <div className="space-y-6">
        <div>
          <p className="text-xs uppercase tracking-[0.4em] text-brand-accent">Purchase</p>
          <h2 className="mt-2 text-3xl font-semibold text-white">{formattedPrice}</h2>
          {selectedVersion && (
            <p className="text-sm text-slate-400">Pinned to {selectedVersion.label}</p>
          )}
        </div>

        <label className="flex flex-col gap-2 text-sm" htmlFor={`version-${model.id}`}>
          <span className="text-slate-400">Version</span>
          <select
            id={`version-${model.id}`}
            value={selectedVersionId}
            onChange={(event) => onSelectVersion(event.currentTarget.value)}
            className="rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-white focus:border-brand focus:outline-none"
          >
            {model.versions.map((version) => (
              <option key={version.id} value={version.id}>
                {version.label} · latency {version.latencyMs} ms
              </option>
            ))}
          </select>
        </label>

        <div className="space-y-3">
          <p className="text-sm text-slate-400">Delivery mode</p>
          <div className="space-y-2">
            {deliveryOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setDeliveryMode(option.value)}
                className={`w-full rounded-2xl border px-4 py-3 text-left text-sm transition ${
                  deliveryMode === option.value
                    ? "border-brand bg-brand/10 text-white"
                    : "border-white/10 text-slate-300 hover:border-brand"
                }`}
                aria-pressed={deliveryMode === option.value}
              >
                <span className="font-semibold">{option.label}</span>
                <p className="text-xs text-slate-400">{option.description}</p>
              </button>
            ))}
          </div>
        </div>

        {isBuyerManaged && (
          <label className="flex flex-col gap-2 text-sm" htmlFor={`pem-${model.id}`}>
            <span className="text-slate-400">Buyer-managed PEM public key</span>
            <textarea
              id={`pem-${model.id}`}
              value={pem}
              onChange={(event) => {
                setPem(event.currentTarget.value);
                setPemTouched(true);
              }}
              className="h-40 rounded-2xl border border-white/10 bg-black/40 p-4 text-white placeholder:text-slate-500 focus:border-brand focus:outline-none"
              placeholder="-----BEGIN PUBLIC KEY-----"
            />
            {!pemValid && pemTouched && (
              <span className="text-xs text-rose-400">Enter a valid PEM-formatted RSA public key.</span>
            )}
          </label>
        )}

        <div className="space-y-2 text-sm">
          <p className="text-slate-400">Trust & posture</p>
          <ul className="space-y-2">
            {model.trustSignals.slice(0, 3).map((signal) => (
              <li key={signal.id} className="rounded-2xl border border-white/10 px-4 py-3">
                <p className="font-semibold text-white">{signal.label}</p>
                <p className="text-xs text-slate-400">{signal.description}</p>
              </li>
            ))}
          </ul>
        </div>

        <div className="space-y-3">
          <button
            type="button"
            onClick={() => handleAction(onAddToCart)}
            disabled={!pemValid}
            className="w-full rounded-2xl bg-brand px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-50"
          >
            Add to cart
          </button>
          <button
            type="button"
            onClick={() => handleAction(onCheckout)}
            disabled={!pemValid}
            className="w-full rounded-2xl border border-white/10 px-4 py-3 text-sm font-semibold text-white hover:border-brand disabled:opacity-50"
          >
            Buy now
          </button>
          <p className="text-center text-xs text-slate-500">
            Stripe test cards only · No live keys stored
          </p>
        </div>
      </div>
    </aside>
  );
}
