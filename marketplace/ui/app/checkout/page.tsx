'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import api from '@/lib/api';
import { v4 as uuidv4 } from 'uuid';
import type { OrderRecord } from '@/types';

/**
 * Simple checkout page:
 * - Prefills sku from ?sku= query param if present.
 * - Step 1: Details (buyer email, company)
 * - Step 2: Payment (mock provider button in dev)
 * - Creates pending order via POST /checkout with Idempotency-Key
 * - Polls GET /order/{id} until settled/finalized
 *
 * This implements the essential UX and can be replaced with a production
 * payment integration (Stripe Checkout) later.
 */

export default function CheckoutPage() {
  const search = useSearchParams();
  const router = useRouter();
  const skuParam = search?.get('sku') || '';

  const [skuId] = useState<string>(skuParam || '');
  const [buyerEmail, setBuyerEmail] = useState<string>('');
  const [company, setCompany] = useState<string>('');
  const [deliveryPref, setDeliveryPref] = useState<'buyer-key' | 'marketplace-key'>('buyer-key');
  const [buyerPublicKey, setBuyerPublicKey] = useState<string>('');
  const [buyerKeyLabel, setBuyerKeyLabel] = useState<string>('buyer-key');

  const [order, setOrder] = useState<OrderRecord | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [polling, setPolling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // idempotency key for this checkout session (stable for retries)
  const idempotencyKey = useMemo(() => `checkout-${uuidv4()}`, []);

  useEffect(() => {
    let mounted = true;
    let timer: any = null;

    async function poll() {
      if (!orderId) return;
      setPolling(true);
      try {
        const res = await api.getOrder(orderId);
        if (!mounted) return;
        const ord = res.order as OrderRecord;
        setOrder(ord);
        // stop polling if finalized or failed
        if (ord.status === 'finalized' || ord.status === 'failed') {
          setPolling(false);
          return;
        }
      } catch (err: any) {
        // ignore polling error, or set error after some attempts
        // eslint-disable-next-line no-console
        console.error('Order poll error', err);
      } finally {
        if (mounted) timer = setTimeout(poll, 1500);
      }
    }

    if (orderId) poll();

    return () => {
      mounted = false;
      if (timer) clearTimeout(timer);
    };
  }, [orderId]);

  function rememberOrder(id: string) {
    if (typeof window === 'undefined' || !id) return;
    try {
      const key = 'illuvrse_orders_v1';
      const existing = JSON.parse(window.localStorage.getItem(key) || '[]');
      const list = Array.isArray(existing) ? existing : [];
      if (!list.includes(id)) {
        const next = [id, ...list].slice(0, 25);
        window.localStorage.setItem(key, JSON.stringify(next));
      }
    } catch {
      // ignore storage issues in non-browser envs
    }
  }

  async function handleCreateCheckout() {
    setLoading(true);
    setError(null);
    try {
      if (!skuId) throw new Error('SKU not selected. Provide ?sku=<sku_id> or choose from catalog.');
      const mode = deliveryPref === 'buyer-key' ? 'buyer-managed' : 'marketplace-managed';
      if (mode === 'buyer-managed' && !buyerPublicKey.trim()) {
        throw new Error('Provide a buyer public key when using buyer-managed encryption.');
      }
      // Build payload in shape backend expects
      const payload = {
        sku_id: skuId,
        buyer_id: buyerEmail || `buyer:${buyerEmail || 'anonymous'}`,
        payment_method: { provider: 'mock', payment_intent: `pi_${uuidv4().slice(0, 8)}` },
        billing_metadata: { company: company || null },
        delivery_preferences:
          mode === 'buyer-managed'
            ? {
                mode,
                buyer_public_key: buyerPublicKey.trim(),
                key_identifier: buyerKeyLabel || undefined,
              }
            : {
                mode,
              },
        order_metadata: { correlation_id: `ui:${Date.now()}` },
      };

      const res = await api.postCheckout(payload, { idempotencyKey });
      const ord = res.order as OrderRecord;
      setOrderId(ord.order_id);
      setOrder(ord);
      rememberOrder(ord.order_id);
      // start polling will pick it up by orderId effect
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.error('Checkout create failed', err);
      setError(err?.message || 'Failed to create checkout');
    } finally {
      setLoading(false);
    }
  }

  async function handleSimulatePayment() {
    // Simulate the payment provider calling webhook that the server expects.
    // This is a dev-only convenience. Production uses real payment provider webhooks.
    if (!orderId) {
      setError('No order to simulate payment for');
      return;
    }
    try {
      setLoading(true);
      const webhookPayload = {
        order_id: orderId,
        provider: 'mock',
        status: 'succeeded',
        payment_intent: `pi-sim-${uuidv4().slice(0, 8)}`,
        amount: order?.amount ?? 0,
        currency: order?.currency ?? 'USD',
      };
      await api.postPaymentWebhook(webhookPayload);
      // The backend should react to the webhook and update order. Poll will pick it up.
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.error('Simulate payment failed', err);
      setError(err?.message || 'Payment simulation failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section>
      <h2 className="text-2xl font-heading font-bold mb-3">Checkout</h2>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 card">
          <h3 className="text-lg font-semibold mb-2">Buyer details</h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="block">
              <div className="text-sm font-medium">Buyer email</div>
              <input
                value={buyerEmail}
                onChange={(e) => setBuyerEmail(e.target.value)}
                placeholder="buyer@example.com"
                className="mt-1 block w-full rounded-md border px-3 py-2"
              />
            </label>

            <label className="block">
              <div className="text-sm font-medium">Company (optional)</div>
              <input
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                placeholder="Acme Corp"
                className="mt-1 block w-full rounded-md border px-3 py-2"
              />
            </label>
          </div>

          <div className="mt-4">
            <div className="text-sm font-medium">Delivery preference</div>
            <div className="mt-2 flex gap-3">
              <label className="inline-flex items-center gap-2">
                <input
                  type="radio"
                  name="delivery"
                  value="buyer-key"
                  checked={deliveryPref === 'buyer-key'}
                  onChange={() => setDeliveryPref('buyer-key')}
                />
                <span className="text-sm">Buyer-managed key</span>
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="radio"
                  name="delivery"
                  value="marketplace-key"
                  checked={deliveryPref === 'marketplace-key'}
                  onChange={() => setDeliveryPref('marketplace-key')}
                />
                <span className="text-sm">Marketplace ephemeral key</span>
              </label>
            </div>
            <p className="text-muted text-sm mt-2">
              Buyer-managed keys give the buyer exclusive access; marketplace-ephemeral keys simplify UX.
            </p>
            {deliveryPref === 'buyer-key' && (
              <div className="mt-3 space-y-3">
                <label className="block">
                  <div className="text-sm font-medium">Buyer public key (PEM)</div>
                  <textarea
                    rows={5}
                    className="mt-1 block w-full rounded-md border px-3 py-2 font-mono text-xs"
                    placeholder="-----BEGIN PUBLIC KEY-----"
                    value={buyerPublicKey}
                    onChange={(e) => setBuyerPublicKey(e.target.value)}
                  />
                </label>
                <label className="block">
                  <div className="text-sm font-medium">Key identifier / label</div>
                  <input
                    className="mt-1 block w-full rounded-md border px-3 py-2"
                    value={buyerKeyLabel}
                    onChange={(e) => setBuyerKeyLabel(e.target.value)}
                  />
                </label>
              </div>
            )}
          </div>

          <div className="mt-6 flex gap-3">
            <button className="btn-primary" onClick={handleCreateCheckout} disabled={loading}>
              {loading ? 'Creating order…' : 'Create Order'}
            </button>
            <button
              className="btn-outline"
              onClick={() => router.push('/marketplace')}
              disabled={loading}
            >
              Continue shopping
            </button>
          </div>

          {error && <div className="mt-4 text-red-600">{error}</div>}
        </div>

        <aside className="card">
          <h3 className="text-lg font-semibold">Order summary</h3>

          <div className="mt-3 text-sm text-muted">
            <div>
              <strong>SKU:</strong> {skuId || '—'}
            </div>
            <div>
              <strong>Buyer:</strong> {buyerEmail || '—'}
            </div>
            <div className="mt-3">
              <strong>Idempotency key</strong>
              <div className="text-xs text-muted mt-1 break-all">{idempotencyKey}</div>
            </div>

            <div className="mt-6">
              {!orderId ? (
                <div className="text-sm text-muted">No order created yet</div>
              ) : (
                <>
                  <div className="text-sm">Order ID: {orderId}</div>
                  <div className="mt-2">
                    <div className="text-sm">Status: <strong>{order?.status || 'pending'}</strong></div>
                    <div className="text-sm mt-2">Created: {order?.created_at || '—'}</div>
                  </div>

                  <div className="mt-4">
                    <button className="btn-primary w-full" onClick={handleSimulatePayment} disabled={loading || order?.status !== 'pending'}>
                      Simulate payment (dev)
                    </button>
                  </div>

                  {(order?.delivery_mode || order?.key_metadata) && (
                    <div className="mt-4 text-xs text-muted space-y-1">
                      <div>
                        <strong>Delivery mode:</strong> {order?.key_metadata?.mode || order?.delivery_mode || '—'}
                      </div>
                      {order?.key_metadata?.buyer_public_key_fingerprint && (
                        <div>
                          <strong>Buyer key fingerprint:</strong> {order.key_metadata.buyer_public_key_fingerprint}
                        </div>
                      )}
                      {order?.key_metadata?.kms_key_id && (
                        <div>
                          <strong>KMS key:</strong> {order.key_metadata.kms_key_id}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </aside>
      </div>

      {/* When order finalized, show link to order page */}
      {order && (order.status === 'finalized' || order.status === 'settled') && (
        <div className="mt-6">
          <div className="card">
            <h3 className="font-semibold">Order completed</h3>
            <div className="mt-2">
              <p>Order <strong>{order.order_id}</strong> is {order.status}.</p>
              <div className="mt-3">
                <button
                  className="btn-outline mr-3"
                  onClick={() => router.push(`/order/${encodeURIComponent(order.order_id)}`)}
                >
                  View Order
                </button>
                <button
                  className="btn-ghost"
                  onClick={() => {
                    // simple download license if present
                    if (order.license) {
                      const blob = new Blob([JSON.stringify(order.license, null, 2)], { type: 'application/json' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `license-${order.order_id}.json`;
                      a.click();
                      URL.revokeObjectURL(url);
                    } else {
                      alert('No license object available yet.');
                    }
                  }}
                >
                  Download License
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
