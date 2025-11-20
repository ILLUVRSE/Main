import classNames from 'classnames';
import { PropsWithChildren } from 'react';

export interface ContainerProps extends React.HTMLAttributes<HTMLDivElement> {
  width?: 'lg' | 'xl';
}

export function Container({ width = 'xl', className, children, ...props }: PropsWithChildren<ContainerProps>) {
  const widths = {
    lg: 'max-w-5xl',
    xl: 'max-w-6xl',
  };

  return (
    <div className={classNames('mx-auto w-full px-6', widths[width], className)} {...props}>
      {children}
    </div>
  );
}

export default Container;
