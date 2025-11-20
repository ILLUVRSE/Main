'use client';

import { ReactNode, useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { IconButton } from './IconButton';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
}

export function Modal({ open, onClose, title, subtitle, children }: ModalProps) {
  const [mounted, setMounted] = useState(false);
  const titleId = useId();

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || !open) {
    return null;
  }

  const target = document.getElementById('modal-root') ?? document.body;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-8">
      <div className="absolute inset-0 bg-[var(--color-overlay)]" role="presentation" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative z-10 w-full max-w-2xl rounded-3xl bg-white p-8 shadow-[0_20px_80px_rgba(0,0,0,0.2)]"
      >
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h2 id={titleId} className="font-heading text-3xl text-[var(--color-primary-accessible)]">
              {title}
            </h2>
            {subtitle && <p className="mt-1 text-sm text-[var(--color-text-muted)]">{subtitle}</p>}
          </div>
          <IconButton aria-label="Close modal" onClick={onClose}>
            ×
          </IconButton>
        </div>
        {children}
      </div>
    </div>,
    target
  );
}

export default Modal;
