import Head from "next/head";
import Link from "next/link";
import { GetServerSideProps } from "next";
import { fetchOrderById } from "@/lib/api";
import { OrderRecord } from "@/lib/types";
import { OrderProofViewer } from "@/components/OrderProofViewer";

interface OrderPageProps {
  order: OrderRecord;
}

export default function OrderDetailPage({ order }: OrderPageProps) {
  return (
    <>
      <Head>
        <title>Order {order.id} · ILLUVRSE Marketplace</title>
      </Head>
      <main className="mx-auto max-w-5xl px-6 py-10">
        <header className="space-y-3 border-b border-white/10 pb-6">
          <p className="text-xs uppercase tracking-[0.3em] text-brand-accent">Order summary</p>
          <h1 className="text-4xl font-semibold text-white">Order {order.id}</h1>
          <div className="text-sm text-slate-400">
            <span className="rounded-full border border-white/10 px-3 py-1 text-white">{order.status.toUpperCase()}</span>
            <span className="ml-4">Created: {new Date(order.createdAt).toLocaleString()}</span>
          </div>
        </header>

        <div className="mt-8 grid gap-6 md:grid-cols-[2fr_1fr]">
          <section className="space-y-6 rounded-3xl border border-white/10 bg-slate-950/60 p-6">
            <div>
              <h2 className="text-2xl font-semibold text-white">License</h2>
              <p className="text-sm text-slate-400">{order.license.name}</p>
              <pre className="mt-4 max-h-80 overflow-auto rounded-2xl bg-black/40 p-4 text-sm text-slate-200">
                {order.license.body}
              </pre>
            </div>
            <div className="rounded-2xl border border-white/10 p-4 text-sm text-slate-300">
              <p className="font-semibold text-white">Key metadata</p>
              <ul className="mt-2 space-y-1">
                <li>Mode: {order.delivery.mode.replace("_", " ")}</li>
                {order.delivery.keyMetadata && (
                  <>
                    <li>Key type: {order.delivery.keyMetadata.key_type}</li>
                    <li>Format: {order.delivery.keyMetadata.format}</li>
                    {order.delivery.keyMetadata.fingerprint && <li>Fingerprint: {order.delivery.keyMetadata.fingerprint}</li>}
                  </>
                )}
                {order.delivery.fulfillmentEta && <li>ETA: {new Date(order.delivery.fulfillmentEta).toLocaleString()}</li>}
              </ul>
              <p className="mt-3 text-xs text-slate-400">
                Use your configured HSM or KMS client to decrypt the payload once the courier publishes the encrypted bundle.
                Buyer-managed mode requires uploading PEM keys under Delivery Preferences on the checkout form.
              </p>
            </div>
            <OrderProofViewer proof={order.proof} />
          </section>

          <aside className="space-y-4 rounded-3xl border border-white/10 bg-black/30 p-6 text-sm text-slate-200">
            <h2 className="text-lg font-semibold text-white">Items</h2>
            <ul className="space-y-3">
              {order.items.map((item) => (
                <li key={item.skuId} className="rounded-2xl border border-white/10 p-3">
                  <p className="font-semibold text-white">{item.modelTitle}</p>
                  <p className="text-slate-400">{item.versionLabel}</p>
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
            <div className="flex items-center justify-between border-t border-white/10 pt-3 text-white">
              <span>Total</span>
              <span>
                {new Intl.NumberFormat("en-US", {
                  style: "currency",
                  currency: order.currency,
                  maximumFractionDigits: 0,
                }).format(order.total)}
              </span>
            </div>
            <Link href="/" className="inline-flex w-full justify-center rounded-full border border-white/20 px-4 py-2 text-sm font-semibold text-white hover:border-brand">
              Back to catalog
            </Link>
          </aside>
        </div>
      </main>
    </>
  );
}

export const getServerSideProps: GetServerSideProps<OrderPageProps> = async (context) => {
  const id = context.params?.id;
  if (typeof id !== "string") {
    return { notFound: true };
  }
  const order = await fetchOrderById(id);
  if (!order) {
    return { notFound: true };
  }
  return {
    props: {
      order,
    },
  };
};
