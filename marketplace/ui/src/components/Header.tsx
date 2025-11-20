'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import classNames from 'classnames';

type NavLink = { label: string; href: string };

const NAV_LINKS: NavLink[] = [
  { label: 'Home', href: '/' },
  { label: 'Features', href: '/#features' },
  { label: 'Marketplace', href: '/marketplace' },
  { label: 'Media', href: '/media' },
  { label: 'Docs', href: '/docs/PRODUCTION' },
];

export default function Header() {
  const pathname = usePathname();
  const { user, login, logout } = useAuth();

  const handleJoin = () => {
    if (!user) {
      login('demo-token', { id: 'user:guest', email: 'guest@illuvrse.com', name: 'Guest', roles: ['buyer'] }, true);
    }
  };

  return (
    <header className="sticky top-0 z-40 px-4 pt-5">
      <div className="mx-auto max-w-6xl rounded-3xl border border-[var(--color-outline)] bg-white/95 shadow-[var(--shadow-header)] backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-4">
          <Link href="/" className="flex items-center gap-3" aria-label="Illuvrse home">
            <div className="relative h-12 w-12">
              <Image src="/brand/logo-mark.png" alt="Illuvrse logo" fill sizes="48px" priority />
            </div>
            <span className="font-heading text-3xl text-[var(--color-primary-accessible)]">illuvrse</span>
          </Link>

          <nav aria-label="Primary" className="order-2 flex flex-1 justify-center gap-6 text-lg text-[var(--color-text-muted)]">
            {NAV_LINKS.map(({ label, href }) => {
              const isActive = pathname === href || (href !== '/' && pathname.startsWith(href.replace('/#', '/')));
              return (
                <Link
                  key={href}
                  href={href}
                  className={classNames(
                    'transition-colors',
                    isActive ? 'text-[var(--color-primary-accessible)]' : 'hover:text-[var(--color-primary)]'
                  )}
                >
                  {label}
                </Link>
              );
            })}
          </nav>

          <div className="order-3 flex items-center gap-3">
            {user && (
              <div className="hidden text-right text-sm text-[var(--color-text-muted)] sm:block">
                <div className="font-accent text-[var(--color-primary-accessible)]">Welcome back</div>
                <div>{user.name ?? user.email}</div>
              </div>
            )}
            {user ? (
              <button
                onClick={() => logout()}
                className="rounded-full border border-[var(--color-outline)] px-4 py-2 text-sm font-semibold text-[var(--color-primary-accessible)] transition hover:bg-[var(--color-surface)]"
                aria-label="Sign out"
              >
                Sign out
              </button>
            ) : (
              <button
                onClick={handleJoin}
                className="rounded-[12px] bg-[var(--color-primary)] px-5 py-2 text-base font-semibold text-white shadow-[var(--shadow-card)] transition hover:bg-[var(--color-primary-accessible)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]"
              >
                Join in
              </button>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
