// app/layout.tsx
import './globals.css';
import Nav from '../components/Nav';

export const metadata = {
  title: 'CommandPad',
  description: 'Administrative CommandPad for ILLUVRSE (placeholder)',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Nav />
        {children}
      </body>
    </html>
  );
}

