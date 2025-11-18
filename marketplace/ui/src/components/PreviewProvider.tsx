'use client';

import React, { createContext, useContext, useState, ReactNode } from 'react';
import PreviewModal from './PreviewModal';

type PreviewContextType = {
  /** Open a preview modal for the given skuId */
  openPreview: (skuId: string) => void;
  /** Close the currently open preview modal */
  closePreview: () => void;
  /** Current skuId being previewed, or null */
  currentSkuId: string | null;
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

  const openPreview = (skuId: string) => {
    setCurrentSkuId(skuId);
  };

  const closePreview = () => {
    setCurrentSkuId(null);
  };

  return (
    <PreviewContext.Provider value={{ openPreview, closePreview, currentSkuId }}>
      {children}
      {currentSkuId && (
        <PreviewModal skuId={currentSkuId} onClose={closePreview} />
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

