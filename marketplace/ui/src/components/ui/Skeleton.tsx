import classNames from 'classnames';

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  shimmer?: boolean;
}

export function Skeleton({ className, shimmer = true, ...props }: SkeletonProps) {
  return (
    <div
      className={classNames(
        'rounded-xl bg-[var(--color-surface)]',
        shimmer && 'animate-pulse',
        className
      )}
      {...props}
    />
  );
}

export default Skeleton;
