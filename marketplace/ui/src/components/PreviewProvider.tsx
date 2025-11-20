'use client';

import React, { createContext, useContext, useState, ReactNode } from 'react';
import api from '@/lib/api';
import type { PreviewSession } from '@/types';
import PreviewModal from './PreviewModal';

type PreviewContextType = {
  /** Open a preview modal for the given skuId */
  openPreview: (skuId: string) => void;
  /** Close the currently open preview modal */
  closePreview: () => void;
  /** Current skuId being previewed, or null */
  currentSkuId: string | null;
  /** Refresh the preview session (fetches a new sandbox) */
  refreshPreview: () => void;
};

const PreviewContext = createContext<PreviewContextType | undefined>(undefined);

/**
 * PreviewProvider
 *
 * Wrap your app (or the part of the app that might open previews).
 * Provides `openPreview(skuId)` which will mount the PreviewModal.
 */
export function PreviewProvider({ children }: { children: ReactNode }) {
  const [currentSkuId, setCurrentSkuId] = useState<string | null>(null);
  const [session, setSession] = useState<PreviewSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function fetchSession(skuId: string) {
    setLoading(true);
    setError(null);
    setSession(null);
    try {
      const created = await api.startPreview(skuId, { ttlSeconds: 600 });
      setSession(created);
    } catch (err: any) {
      setError(err?.message || 'Failed to create preview session');
    } finally {
      setLoading(false);
    }
  }

  const openPreview = (skuId: string) => {
    setCurrentSkuId(skuId);
    fetchSession(skuId);
  };

  const closePreview = () => {
    setCurrentSkuId(null);
    setSession(null);
    setError(null);
    setLoading(false);
  };

  const refreshPreview = () => {
    if (currentSkuId) {
      fetchSession(currentSkuId);
    }
  };

  return (
    <PreviewContext.Provider value={{ openPreview, closePreview, currentSkuId, refreshPreview }}>
      {children}
      {currentSkuId && (
        <PreviewModal
          skuId={currentSkuId}
          session={session}
          loading={loading}
          error={error}
          onRetry={refreshPreview}
          onClose={closePreview}
        />
      )}
    </PreviewContext.Provider>
  );
}

/**
 * Hook: usePreview
 *
 * Use this inside client components to open/close the preview modal.
 *
 * Example:
 *   const { openPreview } = usePreview();
 *   <button onClick={() => openPreview('sku-123')}>Preview</button>
 */
export function usePreview() {
  const ctx = useContext(PreviewContext);
  if (!ctx) {
    throw new Error('usePreview must be used within a <PreviewProvider />');
  }
  return ctx;
}
