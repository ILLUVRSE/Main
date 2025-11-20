import classNames from 'classnames';

export type BadgeVariant = 'default' | 'accent' | 'outline';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

const variants: Record<BadgeVariant, string> = {
  default: 'bg-[var(--color-surface)] text-[var(--color-primary-accessible)]',
  accent: 'bg-[var(--color-accent-gold)] text-[var(--color-bg-dark)]',
  outline: 'border border-[var(--color-outline)] text-[var(--color-text-muted)]',
};

export function Badge({ variant = 'default', className, ...props }: BadgeProps) {
  return (
    <span
      className={classNames(
        'font-accent text-xs uppercase tracking-[0.3em] rounded-full px-3 py-1',
        variants[variant],
        className
      )}
      {...props}
    />
  );
}

export default Badge;
