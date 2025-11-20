import classNames from 'classnames';
import { forwardRef } from 'react';

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'ghost';
  size?: 'sm' | 'md';
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { variant = 'ghost', size = 'md', className, ...props },
  ref
) {
  const sizes = {
    sm: 'h-9 w-9',
    md: 'h-11 w-11',
  };

  const variants = {
    primary:
      'bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary-accessible)] shadow-card rounded-full',
    ghost: 'border border-[var(--color-outline)] text-[var(--color-primary-accessible)] rounded-full hover:bg-[var(--color-surface)]',
  };

  return (
    <button
      ref={ref}
      className={classNames(
        'inline-flex items-center justify-center transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]',
        sizes[size],
        variants[variant],
        className
      )}
      {...props}
    />
  );
});

export default IconButton;
