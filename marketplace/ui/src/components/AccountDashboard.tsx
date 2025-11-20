'use client';

import React, { useEffect, useState } from 'react';
import api from '@/lib/api';
import type { OrderRecord, License, Delivery } from '@/types';
import { formatCurrency } from '@/lib/utils/formatCurrency';

/**
 * AccountDashboard
 *
 * Lightweight account page widget showing:
 * - Orders (stored in localStorage as illuvrse_orders_v1 for demo/dev)
 * - Ability to refresh each order from GET /order/{orderId}
 * - Quick view of license/delivery with verify button (POST /license/verify)
 *
 * This intentionally supports a local-storage driven fallback so it works
 * in demo/staging without a full user-orders backend.
 */

const ORDERS_KEY = 'illuvrse_orders_v1';

function loadOrderIds(): string[] {
  try {
    if (typeof window === 'undefined') return [];
    const raw = window.localStorage.getItem(ORDERS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as string[];
  } catch {
    return [];
  }
}

function saveOrderIds(ids: string[]) {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(ORDERS_KEY, JSON.stringify(ids));
  } catch {
    // ignore
  }
}

export default function AccountDashboard() {
  const [orderIds, setOrderIds] = useState<string[]>([]);
  const [orders, setOrders] = useState<Record<string, OrderRecord | null>>({});
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ids = loadOrderIds();
    setOrderIds(ids);
    // optionally preload details
    ids.forEach((id) => {
      fetchOrder(id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fetchOrder(orderId: string) {
    setError(null);
    setOrders((s) => ({ ...s, [orderId]: null }));
    try {
      const res = await api.getOrder(orderId);
      if (res && res.order) {
        setOrders((s) => ({ ...s, [orderId]: res.order as OrderRecord }));
      } else {
        setOrders((s) => ({ ...s, [orderId]: null }));
      }
    } catch (err: any) {
      setOrders((s) => ({ ...s, [orderId]: null }));
      setError(String(err?.message || err));
    }
  }

  async function refreshAll() {
    setLoading(true);
    setError(null);
    try {
      await Promise.all(orderIds.map((id) => fetchOrder(id)));
    } finally {
      setLoading(false);
    }
  }

  function removeOrder(orderId: string) {
    const next = orderIds.filter((id) => id !== orderId);
    setOrderIds(next);
    saveOrderIds(next);
    setOrders((s) => {
      const c = { ...s };
      delete c[orderId];
      return c;
    });
  }

  function addOrderManually() {
    const id = prompt('Enter order id to add (e.g., order-...)') || '';
    if (!id) return;
    if (orderIds.includes(id)) {
      alert('Order already present');
      return;
    }
    const next = [id, ...orderIds];
    setOrderIds(next);
    saveOrderIds(next);
    fetchOrder(id);
  }

  async function verifyLicense(license: License | undefined) {
    if (!license) {
      alert('No license provided');
      return;
    }
    try {
      const res = await api.postLicenseVerify(license, license.buyer_id);
      if (res && (res.verified === true || res.verified === false)) {
        alert(`License verified: ${res.verified ? 'OK' : 'Mismatch'}`);
      } else {
        alert('Verification result unavailable');
      }
    } catch (err: any) {
      alert('Verification failed: ' + (err?.message || String(err)));
    }
  }

  function renderDeliveryActions(delivery: Delivery | undefined) {
    if (!delivery) return null;
    return (
      <div className="flex gap-2 items-center">
        {delivery.encrypted_delivery_url ? (
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              alert('Encrypted delivery URL: ' + delivery.encrypted_delivery_url);
            }}
            className="btn-outline text-xs"
          >
            Download (encrypted)
          </a>
        ) : (
          <div className="text-xs text-muted">No delivery URL</div>
        )}
        {delivery.proof_id && (
          <a
            href={`/proofs/${encodeURIComponent(delivery.proof_id)}`}
            className="btn-ghost text-xs"
          >
            View proof
          </a>
        )}
      </div>
    );
  }

  function renderKeyMetadata(meta: any, deliveryMode?: string) {
    if (!meta && !deliveryMode) return null;
    return (
      <div className="mt-2 text-xs text-muted space-y-1">
        <div>
          <strong>Delivery mode:</strong> {meta?.mode || deliveryMode || '—'}
        </div>
        {meta?.buyer_public_key_fingerprint && (
          <div>
            <strong>Buyer key fingerprint:</strong> {meta.buyer_public_key_fingerprint}
          </div>
        )}
        {meta?.kms_key_id && (
          <div>
            <strong>KMS key:</strong> {meta.kms_key_id}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="container p-6">
      <h2 className="text-2xl font-heading font-bold mb-3">Account</h2>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 card">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="text-lg font-semibold">Orders</div>
              <div className="text-sm text-muted">Recent orders and licenses</div>
            </div>

            <div className="flex items-center gap-2">
              <button onClick={addOrderManually} className="btn-ghost text-sm">Add order</button>
              <button onClick={refreshAll} className="btn-primary text-sm">
                {loading ? 'Refreshing…' : 'Refresh all'}
              </button>
            </div>
          </div>

          {orderIds.length === 0 ? (
            <div className="text-muted text-sm">No orders found. Place an order or add an order id manually.</div>
          ) : (
            <div className="space-y-4">
              {orderIds.map((id) => {
                const o = orders[id];
                return (
                  <div key={id} className="p-3 border rounded-md">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="text-sm font-medium">{o?.sku_id || '—'}</div>
                        <div className="text-xs text-muted">Order: <span className="font-mono">{id}</span></div>
                        <div className="mt-1 text-xs text-muted">Status: {o?.status || '—'}</div>
                      </div>

                      <div className="text-right">
                        <div className="text-sm font-semibold">{o ? formatCurrency(o.amount || 0, o.currency || 'USD') : '—'}</div>
                        <div className="mt-2 flex flex-col items-end gap-2">
                          <button onClick={() => fetchOrder(id)} className="btn-ghost text-xs">Refresh</button>
                          <button onClick={() => removeOrder(id)} className="btn-outline text-xs">Remove</button>
                        </div>
                      </div>
                    </div>

                    <div className="mt-3">
                      <div className="text-sm font-semibold">License</div>
                      {o?.license ? (
                        <div className="mt-2 space-y-2">
                          <div className="text-xs text-muted">License id: <span className="font-mono">{o.license.license_id}</span></div>
                          <div className="text-sm">Scope: {o.license.scope?.type || '—'}</div>
                          <div className="flex items-center gap-2 mt-2">
                            <button className="btn-outline text-xs" onClick={() => verifyLicense(o.license)}>Verify</button>
                            {o.license.signature && <div className="text-xs text-muted">Signed ({o.license.signer_kid})</div>}
                          </div>
                        </div>
                      ) : (
                        <div className="text-sm text-muted mt-2">No license available</div>
                      )}
                    </div>

                    <div className="mt-3">
                      <div className="text-sm font-semibold">Delivery</div>
                      <div className="mt-2">
                        {renderDeliveryActions(o?.delivery)}
                      </div>
                    </div>
                    {renderKeyMetadata(o?.key_metadata, o?.delivery_mode)}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <aside className="card">
          <h3 className="text-lg font-semibold">Quick actions</h3>
          <div className="mt-3 text-sm text-muted space-y-3">
            <div>
              <button
                className="btn-outline w-full"
                onClick={() => {
                  // clear stored order ids (dev convenience)
                  if (confirm('Clear local stored order ids?')) {
                    saveOrderIds([]);
                    setOrderIds([]);
                    setOrders({});
                  }
                }}
              >
                Clear local orders
              </button>
            </div>

            <div>
              <button
                className="btn-ghost w-full"
                onClick={() => {
                  // produce a helpful message about where to get order ids
                  alert('Order ids are stored locally for demo purposes under key "' + ORDERS_KEY + '". Add order ids via "Add order" above or by making a purchase.');
                }}
              >
                Where do order ids come from?
              </button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
