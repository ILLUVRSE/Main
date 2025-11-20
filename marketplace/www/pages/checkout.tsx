import Head from "next/head";
import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe, StripeElementsOptions } from "@stripe/stripe-js";
import { computeCartTotals, submitCheckout } from "@/lib/api";
import { CheckoutBuyer, DeliveryMode } from "@/lib/types";
import { useCart } from "@/context/cart";

const stripePromise = typeof window === "undefined"
  ? null
  : loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "");

type CheckoutStep = "details" | "payment" | "success";

type PaymentStageProps = {
  onSuccess: () => void;
};

function PaymentStage({ onSuccess }: PaymentStageProps) {
  const stripe = useStripe();
  const elements = useElements();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleConfirm() {
    if (!stripe || !elements) return;
    setSubmitting(true);
    setError(null);
    const result = await stripe.confirmPayment({
      elements,
      redirect: "if_required",
    });
    if (result.error) {
      setError(result.error.message ?? "Unable to confirm payment.");
      setSubmitting(false);
      return;
    }
    onSuccess();
  }

  return (
    <div className="space-y-4">
      <PaymentElement options={{ layout: "tabs" }} />
      <button
        type="button"
        disabled={!stripe || submitting}
        onClick={handleConfirm}
        className="w-full rounded-2xl bg-brand px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
      >
        {submitting ? "Confirming..." : "Confirm payment"}
      </button>
      {error && <p className="text-sm text-rose-400">{error}</p>}
    </div>
  );
}

export default function CheckoutPage() {
  const { items, totalItems, removeItem, clear } = useCart();
  const [buyer, setBuyer] = useState<CheckoutBuyer>({ name: "", email: "", company: "" });
  const [notes, setNotes] = useState("");
  const [deliveryMode, setDeliveryMode] = useState<DeliveryMode>("marketplace_managed");
  const [step, setStep] = useState<CheckoutStep>("details");
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const totals = useMemo(() => computeCartTotals(items), [items]);
  const currencyCode = items[0]?.currency ?? "USD";
  const currencyFormatter = useMemo(
    () =>
      new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: currencyCode,
        maximumFractionDigits: 2,
      }),
    [currencyCode]
  );
  const isCartEmpty = items.length === 0;

  async function handleDetailsSubmit(event: FormEvent) {
    event.preventDefault();
    if (isCartEmpty) {
      setStatusMessage("Your cart is empty.");
      return;
    }
    setIsSubmitting(true);
    setStatusMessage(null);
    try {
      const summary = await submitCheckout({
        cart: items,
        buyer: { ...buyer, notes },
        deliveryPreferences: {
          deliveryMode,
        },
      });
      setOrderId(summary.orderId);
      setClientSecret(summary.clientSecret);
      if (summary.clientSecret.startsWith("demo")) {
        clear();
        setStep("success");
        return;
      }
      if (!stripePromise) {
        setStatusMessage("Stripe publishable key missing; set NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY to continue.");
        return;
      }
      setStep("payment");
    } catch (error) {
      setStatusMessage("Checkout could not be initialized.");
    } finally {
      setIsSubmitting(false);
    }
  }

  function handlePaymentSuccess() {
    clear();
    setStep("success");
  }

  const elementsOptions: StripeElementsOptions | undefined = clientSecret
    ? {
        clientSecret,
        appearance: { theme: "night" },
      }
    : undefined;

  return (
    <>
      <Head>
        <title>Checkout · ILLUVRSE Marketplace</title>
      </Head>
      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="flex flex-col gap-6 border-b border-white/10 pb-6">
          <p className="text-xs uppercase tracking-[0.3em] text-brand-accent">Secure checkout</p>
          <h1 className="text-4xl font-semibold text-white">Complete your purchase</h1>
          <p className="text-sm text-slate-400">
            Cart summary includes trust signals, sandbox access, and proof-of-delivery pipeline. Stripe test mode only.
          </p>
        </div>

        {isCartEmpty && step !== "success" ? (
          <div className="mt-10 rounded-3xl border border-dashed border-white/10 p-8 text-center text-slate-300">
            Your cart is empty. <Link href="/" className="text-brand">Browse models</Link> to add manifests.
          </div>
        ) : (
          <div className="mt-10 grid gap-8 lg:grid-cols-[2fr_1fr]">
            <section className="space-y-6 rounded-3xl border border-white/10 bg-slate-950/70 p-6">
              {step === "details" && (
                <form onSubmit={handleDetailsSubmit} className="space-y-6">
                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="flex flex-col gap-2 text-sm" htmlFor="buyer-name">
                      <span className="text-slate-400">Full name</span>
                      <input
                        id="buyer-name"
                        value={buyer.name}
                        onChange={(event) => setBuyer((prev) => ({ ...prev, name: event.currentTarget.value }))}
                        required
                        className="rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-white focus:border-brand focus:outline-none"
                      />
                    </label>
                    <label className="flex flex-col gap-2 text-sm" htmlFor="buyer-email">
                      <span className="text-slate-400">Work email</span>
                      <input
                        id="buyer-email"
                        type="email"
                        required
                        value={buyer.email}
                        onChange={(event) => setBuyer((prev) => ({ ...prev, email: event.currentTarget.value }))}
                        className="rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-white focus:border-brand focus:outline-none"
                      />
                    </label>
                  </div>
                  <label className="flex flex-col gap-2 text-sm" htmlFor="buyer-company">
                    <span className="text-slate-400">Company (optional)</span>
                    <input
                      id="buyer-company"
                      value={buyer.company ?? ""}
                      onChange={(event) => setBuyer((prev) => ({ ...prev, company: event.currentTarget.value }))}
                      className="rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-white focus:border-brand focus:outline-none"
                    />
                  </label>
                  <label className="flex flex-col gap-2 text-sm" htmlFor="buyer-notes">
                    <span className="text-slate-400">Notes for delivery team</span>
                    <textarea
                      id="buyer-notes"
                      value={notes}
                      onChange={(event) => setNotes(event.currentTarget.value)}
                      className="h-28 rounded-2xl border border-white/10 bg-black/40 p-4 text-white focus:border-brand focus:outline-none"
                    />
                  </label>

                  <div className="space-y-3">
                    <p className="text-sm text-slate-400">Delivery mode</p>
                    <div className="grid gap-3 md:grid-cols-2">
                      {["marketplace_managed", "buyer_managed"].map((mode) => (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => setDeliveryMode(mode as DeliveryMode)}
                          className={`rounded-2xl border px-4 py-3 text-left text-sm transition ${
                            deliveryMode === mode
                              ? "border-brand bg-brand/10 text-white"
                              : "border-white/10 text-slate-300 hover:border-brand"
                          }`}
                          aria-pressed={deliveryMode === mode}
                        >
                          <span className="font-semibold capitalize">{mode.replace("_", " ")}</span>
                          <p className="text-xs text-slate-400">
                            {mode === "marketplace_managed"
                              ? "Managed handoff with notarized proof"
                              : "BYO delivery keys (configured later)"}
                          </p>
                        </button>
                      ))}
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full rounded-2xl bg-brand px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    {isSubmitting ? "Preparing Stripe" : "Continue to payment"}
                  </button>
                  {statusMessage && <p className="text-sm text-rose-400">{statusMessage}</p>}
                </form>
              )}

              {step === "payment" && clientSecret && stripePromise && elementsOptions && (
                <Elements stripe={stripePromise} options={elementsOptions}>
                  <PaymentStage onSuccess={handlePaymentSuccess} />
                </Elements>
              )}

              {step === "success" && (
                <div className="space-y-4 text-center text-slate-200">
                  <p className="text-3xl font-semibold text-white">Order ready</p>
                  <p>We recorded your manifest request and delivery proof pipeline is warming up.</p>
                  {orderId && (
                    <Link
                      href={`/order/${orderId}`}
                      className="inline-flex rounded-full bg-brand px-6 py-3 text-sm font-semibold text-white"
                    >
                      View order {orderId}
                    </Link>
                  )}
                </div>
              )}
            </section>

            <aside className="space-y-6 rounded-3xl border border-white/10 bg-black/30 p-6">
              <div className="flex items-center justify-between text-sm text-slate-300">
                <span>Items ({totalItems})</span>
                <Link href="/" className="text-brand">
                  Edit cart
                </Link>
              </div>
              <ul className="space-y-4">
                {items.map((item) => (
                  <li key={`${item.skuId}-${item.versionId}`} className="rounded-2xl border border-white/10 p-4 text-sm">
                    <div className="flex items-center justify-between text-white">
                      <p className="font-semibold">{item.modelTitle}</p>
                      <button
                        type="button"
                        onClick={() => removeItem(item.skuId, item.versionId)}
                        className="text-xs text-rose-400"
                      >
                        Remove
                      </button>
                    </div>
                    <p className="text-slate-400">{item.versionLabel}</p>
                    <p className="text-slate-400">Qty {item.quantity}</p>
                    <p className="text-white">
                      {new Intl.NumberFormat("en-US", {
                        style: "currency",
                        currency: item.currency,
                        maximumFractionDigits: 0,
                      }).format(item.price)}
                    </p>
                  </li>
                ))}
              </ul>
              <div className="space-y-2 text-sm text-slate-300">
                <div className="flex items-center justify-between">
                  <span>Subtotal</span>
                  <span>{currencyFormatter.format(totals.subtotal)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Trust & custody fee</span>
                  <span>{currencyFormatter.format(totals.fees)}</span>
                </div>
                <div className="flex items-center justify-between text-white">
                  <span>Total due</span>
                  <span>{currencyFormatter.format(totals.total)}</span>
                </div>
              </div>
              <div className="rounded-2xl border border-white/10 p-4 text-xs text-slate-400">
                Stripe publishable key: {process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ? "loaded" : "missing"}. Use
                4242 4242 4242 4242 in test mode.
              </div>
            </aside>
          </div>
        )}
      </main>
    </>
  );
}
