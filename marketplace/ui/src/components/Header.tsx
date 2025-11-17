"use client"
import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useAuth } from '@/lib/auth';

type NavItem = { label: string; href: string };

const NAV_ITEMS: NavItem[] = [
  { label: 'Marketplace', href: '/marketplace' },
  { label: 'Docs', href: '/docs/PRODUCTION' },
  { label: 'Admin', href: '/admin' },
];

export default function Header() {
  const { user, login, logout, isOperator } = useAuth();

  // lightweight sign-in for dev convenience
  const handleDevLogin = async () => {
    // In real app use OIDC. Here we simulate a login and set a dummy token.
    const demoToken = 'demo-token';
    const demoUser = { id: 'user:demo', email: 'demo@illuvrse.com', name: 'Demo User', roles: ['buyer'] };
    login(demoToken, demoUser, true);
  };

  return (
    <header className="site-header">
      <div className="container flex items-center justify-between py-3">
        <div className="flex items-center gap-4">
          <Link href="/" className="flex items-center gap-3">
            <div className="w-10 h-10 relative">
              <Image src="/brand/logo-icon-64.png" alt="Illuvrse" fill style={{ objectFit: 'contain' }} />
            </div>
            <div className="hidden md:block">
              <h1 className="text-xl font-heading">illuvrse</h1>
            </div>
          </Link>
        </div>

        <nav className="hidden lg:flex items-center gap-6">
          {NAV_ITEMS.map((n) => (
            <Link key={n.href} href={n.href} className="nav-link">
              {n.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          {/* Search bar (small) */}
          <div className="hidden md:flex items-center border rounded-md px-3 py-1 bg-white shadow-sm">
            <input
              type="search"
              aria-label="Search marketplace"
              placeholder="Search models, authors, tags..."
              className="outline-none w-56 text-sm"
            />
            <button className="ml-2 text-[var(--illuvrse-primary)] font-semibold">Search</button>
          </div>

          {/* Operator quick link */}
          {isOperator() && (
            <Link href="/admin" className="btn-ghost hidden md:inline-block">
              Operator
            </Link>
          )}

          {/* Cart / Account */}
          <div className="flex items-center gap-3">
            <Link href="/cart" className="btn-ghost">
              Cart
            </Link>

            {user ? (
              <div className="flex items-center gap-2">
                <div className="text-sm">
                  <div className="font-medium">{user.name || user.email}</div>
                </div>
                <button
                  onClick={() => logout()}
                  className="btn-ghost text-sm"
                  title="Sign out"
                >
                  Sign out
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  onClick={handleDevLogin}
                  className="btn-outline text-sm hidden md:inline-block"
                  title="Sign in (dev)"
                >
                  Sign in
                </button>
                <Link href="/account/register" className="btn-primary text-sm">
                  Join In
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}

