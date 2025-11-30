import React from 'react';

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ backgroundColor: 'var(--color-bg)', color: 'var(--color-bg-dark)' }}>
      <header>
        <h1>Marketplace</h1>
      </header>
      <main>{children}</main>
      <footer>
        <p>© 2024 Illuvrse</p>
      </footer>
    </div>
  );
}
