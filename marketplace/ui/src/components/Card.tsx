'use client';

import React from 'react';
import clsx from 'clsx';

type CardProps = {
  children?: React.ReactNode;
  className?: string;
  as?: 'div' | 'section' | 'article' | 'aside';
  role?: string;
  padded?: boolean;
  shadow?: 'soft' | 'strong' | 'none';
};

/**
 * Simple Card wrapper that applies consistent padding, radius and shadow.
 * Use `padded={false}` to remove default padding when embedding complex layouts.
 *
 * Example:
 *  <Card className="w-full" padded> ... </Card>
 */

export default function Card({
  children,
  className,
  as = 'div',
  role,
  padded = true,
  shadow = 'soft',
}: CardProps) {
  const Tag = as as any;

  const base = 'bg-white rounded-md';
  const paddingClass = padded ? 'p-4' : '';
  const shadowClass =
    shadow === 'none' ? '' : shadow === 'strong' ? 'shadow-illuvrse-strong' : 'shadow-illuvrse-soft';

  const classes = clsx(base, paddingClass, shadowClass, className);

  return (
    <Tag className={classes} role={role}>
      {children}
    </Tag>
  );
}

