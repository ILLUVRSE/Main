import React from 'react';
import { Cormorant_Garamond, Inter, Space_Grotesk } from 'next/font/google';
import '@/styles/globals.css';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import { AuthProvider } from '@/lib/auth';

const heading = Cormorant_Garamond({
  subsets: ['latin'],
  display: 'swap',
  weight: ['400', '500', '600', '700'],
  variable: '--font-heading',
});

const body = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-body',
});

const accent = Space_Grotesk({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-accent',
});

export const metadata = {
  title: 'ILLUVRSE',
  description: 'Illuvrse — editorial-grade marketplace for verifiable metaverse artifacts and manifests.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${heading.variable} ${body.variable} ${accent.variable} bg-[var(--color-bg-light)]`}>
        <a href="#main" className="skip-nav">
          Skip to main content
        </a>
        <AuthProvider>
          <div className="flex min-h-screen flex-col">
            <Header />
            <main id="main" className="flex-1">
              {children}
            </main>
            <Footer />
            <div id="modal-root" />
          </div>
        </AuthProvider>
      </body>
    </html>
  );
}
