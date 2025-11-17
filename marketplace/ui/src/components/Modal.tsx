'use client';

import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';

type ModalProps = {
  open: boolean;
  onClose: () => void;
  title?: string;
  children?: React.ReactNode;
  className?: string;
  closeOnBackdrop?: boolean;
  ariaLabel?: string;
};

/**
 * Simple accessible Modal component using a portal.
 * - Renders into a #modal-root element (create this in app/layout.tsx).
 * - Handles Esc key to close, optional backdrop click to close.
 * - Focus is returned to the previous active element on close.
 *
 * Note: This is a light-weight modal implementation for the UI; for
 * production you may want a more complete focus-trap library.
 */

export default function Modal({
  open,
  onClose,
  title,
  children,
  className,
  closeOnBackdrop = true,
  ariaLabel,
}: ModalProps) {
  const rootRef = useRef<HTMLElement | null>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // Ensure modal-root exists
    let root = document.getElementById('modal-root') as HTMLElement | null;
    if (!root) {
      root = document.createElement('div');
      root.id = 'modal-root';
      document.body.appendChild(root);
    }
    rootRef.current = root;
  }, []);

  useEffect(() => {
    if (!open) return;

    previouslyFocused.current = document.activeElement as HTMLElement | null;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
      // Optional: trap Tab within modal
      if (e.key === 'Tab' && contentRef.current) {
        const focusable = contentRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };

    document.addEventListener('keydown', onKey, true);

    // Prevent background scroll while modal open
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Focus the first focusable element inside modal after render
    setTimeout(() => {
      if (contentRef.current) {
        const focusable = contentRef.current.querySelector<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        (focusable || contentRef.current).focus();
      }
    }, 0);

    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = originalOverflow;
      // restore focus
      try {
        previouslyFocused.current?.focus();
      } catch {
        // ignore
      }
    };
  }, [open, onClose]);

  if (!open || !rootRef.current) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel || title || 'Dialog'}
      className="fixed inset-0 z-50 flex items-center justify-center"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onMouseDown={(e) => {
          if (!closeOnBackdrop) return;
          // Only close when clicking backdrop, not when clicking inside content
          if (e.target === e.currentTarget) onClose();
        }}
      />

      {/* Modal content */}
      <div
        ref={contentRef}
        tabIndex={-1}
        className={clsx('relative z-10 w-full max-w-3xl mx-4 bg-white rounded-lg shadow-illuvrse-strong', className)}
        onMouseDown={(e) => {
          // stop propagation to avoid backdrop closing when clicking inside
          e.stopPropagation();
        }}
      >
        <div className="flex items-start justify-between p-4 border-b">
          <div className="text-lg font-semibold">{title}</div>
          <div>
            <button
              aria-label="Close"
              onClick={onClose}
              className="inline-flex items-center justify-center rounded-md p-2 hover:bg-gray-100"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="p-4">{children}</div>
      </div>
    </div>,
    rootRef.current
  );
}

