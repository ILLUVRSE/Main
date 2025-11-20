import classNames from 'classnames';
import { PropsWithChildren } from 'react';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  padding?: 'sm' | 'md' | 'lg';
  elevated?: boolean;
}

export function Card({ padding = 'md', elevated = true, className, children, ...props }: PropsWithChildren<CardProps>) {
  const paddingClasses = {
    sm: 'p-4',
    md: 'p-6',
    lg: 'p-8',
  };

  return (
    <div
      className={classNames(
        'rounded-3xl border border-[var(--color-outline)] bg-white',
        elevated && 'shadow-card',
        paddingClasses[padding],
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export default Card;
