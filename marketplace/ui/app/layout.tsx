import React from 'react';
import '../src/styles/globals.css';
import Header from '../src/components/Header';
import { AuthProvider } from '../src/lib/auth';

/**
 * Root layout for Next.js App Router.
 * - Imports global styles.
 * - Renders Header and basic Footer.
 * - Wraps the app in AuthProvider (client component).
 *
 * Save to `marketplace/ui/app/layout.tsx`.
 */

export const metadata = {
  title: 'ILLUVRSE Marketplace',
  description: 'Marketplace for Illuvrse — catalog, preview, checkout, delivery proofs and audits',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {/* AuthProvider is a client component; it's safe to use inside server layout */}
        <AuthProvider>
          <Header />
          <main className="container mt-8 mb-12">{children}</main>

          <footer className="site-footer">
            <div className="container flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-3">
                  <img src="/brand/logo-icon-64.png" alt="Illuvrse" width={40} height={40} />
                  <div>
                    <div className="font-heading text-lg">illuvrse</div>
                    <div className="text-muted text-sm">© {new Date().getFullYear()} Illuvrse</div>
                  </div>
                </div>
              </div>

              <div className="flex gap-6 text-sm text-muted mt-4 md:mt-0">
                <a href="/marketplace">Marketplace</a>
                <a href="/docs/PRODUCTION">Docs</a>
                <a href="/admin">Admin</a>
              </div>

              <div className="text-sm text-muted mt-4 md:mt-0">
                Built with ❤️ — lighthouse & orbital inspiration
              </div>
            </div>
          </footer>

          {/* Modal root if you want to mount portals */}
          <div id="modal-root" />
        </AuthProvider>
      </body>
    </html>
  );
}

