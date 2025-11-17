'use client';

import React from 'react';
import clsx from 'clsx';

type BaseProps = {
  children?: React.ReactNode;
  className?: string;
  title?: string;
  'aria-label'?: string;
};

type ButtonProps =
  | (BaseProps & React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'outline' | 'ghost'; as?: 'button' })
  | (BaseProps & React.AnchorHTMLAttributes<HTMLAnchorElement> & { variant?: 'primary' | 'outline' | 'ghost'; as: 'a' });

/**
 * Simple themeable Button component that maps to the brand tokens.
 * Accepts `variant` = 'primary' | 'outline' | 'ghost' and applies classes.
 *
 * Usage:
 *  <Button variant="primary" onClick={...}>Buy</Button>
 *  <Button as="a" href="/docs" variant="outline">Docs</Button>
 */

export default function Button(props: ButtonProps) {
  const { variant = 'primary', className, children, title, 'aria-label': ariaLabel, ...rest } = props as any;

  const base = 'inline-flex items-center justify-center rounded-[var(--btn-radius)] font-semibold transition-shadow focus:outline-none focus-visible:ring-4';
  const variants: Record<string, string> = {
    primary: 'bg-[var(--illuvrse-primary)] text-white px-4 py-2 shadow-illuvrse-soft hover:bg-[var(--illuvrse-primary-light)]',
    outline: 'bg-transparent border-2 border-[var(--illuvrse-primary)] text-[var(--illuvrse-primary)] px-4 py-2',
    ghost: 'bg-transparent text-[var(--text)] px-3 py-2 border border-transparent hover:bg-gray-50',
  };

  const classes = clsx(base, variants[variant] || variants.primary, className);

  if ((props as any).as === 'a') {
    const aProps = rest as React.AnchorHTMLAttributes<HTMLAnchorElement>;
    return (
      <a className={classes} title={title} aria-label={ariaLabel} {...aProps}>
        {children}
      </a>
    );
  }

  const btnProps = rest as React.ButtonHTMLAttributes<HTMLButtonElement>;
  return (
    <button className={classes} title={title} aria-label={ariaLabel} {...btnProps}>
      {children}
    </button>
  );
}

