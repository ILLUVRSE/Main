'use client';

import React from 'react';
import clsx from 'clsx';

type BadgeProps = {
  children?: React.ReactNode;
  className?: string;
  variant?: 'default' | 'success' | 'warning' | 'gold' | 'muted';
  size?: 'sm' | 'md' | 'lg';
  pill?: boolean;
  as?: 'span' | 'div';
};

/**
 * Small Badge / Chip UI primitive.
 *
 * Examples:
 *  <Badge variant="success">Verified</Badge>
 *  <Badge variant="gold" size="sm"> $19.99 </Badge>
 */

export default function Badge({
  children,
  className,
  variant = 'default',
  size = 'md',
  pill = true,
  as = 'span',
}: BadgeProps) {
  const Tag = as as any;

  const base = 'inline-flex items-center font-semibold';
  const radius = pill ? 'rounded-full' : 'rounded-md';

  const sizeMap: Record<string, string> = {
    sm: 'text-xs px-2 py-1',
    md: 'text-sm px-3 py-1.5',
    lg: 'text-sm px-4 py-2',
  };

  const variantMap: Record<string, string> = {
    default: 'bg-gray-100 text-[var(--text)]',
    success: 'bg-green-50 text-green-700',
    warning: 'bg-yellow-50 text-yellow-800',
    gold: 'bg-gradient-to-r from-[var(--illuvrse-gold)] to-[var(--illuvrse-gold-2)] text-[#071216]',
    muted: 'bg-transparent text-[var(--muted)]',
  };

  const classes = clsx(base, radius, sizeMap[size], variantMap[variant], className);

  return <Tag className={classes}>{children}</Tag>;
}

