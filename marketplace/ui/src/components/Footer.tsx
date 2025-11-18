import React from 'react';
import Image from 'next/image';
import Link from 'next/link';

export default function Footer() {
  return (
    <footer className="site-footer">
      <div className="container flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <div style={{ width: 40, height: 40, position: 'relative' }}>
              <Image src="/brand/logo-icon-64.svg" alt="Illuvrse" width={40} height={40} />
            </div>
            <div>
              <div className="font-heading text-lg">illuvrse</div>
              <div className="text-muted text-sm">© {new Date().getFullYear()} Illuvrse</div>
            </div>
          </div>
        </div>

        <nav className="flex gap-6 text-sm text-muted mt-4 md:mt-0">
          <Link href="/marketplace">Marketplace</Link>
          <Link href="/docs/PRODUCTION">Docs</Link>
          <Link href="/admin">Admin</Link>
        </nav>

        <div className="text-sm text-muted mt-4 md:mt-0">
          Built with ❤️ — lighthouse & orbital inspiration
        </div>
      </div>
    </footer>
  );
}

