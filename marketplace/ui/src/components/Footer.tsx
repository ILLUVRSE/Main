import Image from 'next/image';
import Link from 'next/link';

const NAV_LINKS = [
  { label: 'About', href: '/about' },
  { label: 'Blog', href: '/blog' },
  { label: 'Support', href: '/support' },
  { label: 'Contact', href: '/contact' },
];

const SOCIAL = [
  { label: 'LinkedIn', href: 'https://www.linkedin.com/company/illuvrse', icon: 'in' },
  { label: 'Discord', href: 'https://discord.gg/illuvrse', icon: 'dc' },
  { label: 'X', href: 'https://x.com/illuvrse', icon: 'x' },
];

export default function Footer() {
  return (
    <footer className="border-t border-[var(--color-outline)] bg-[var(--color-bg-light)]">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-10 text-[var(--color-text-muted)] md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <div className="relative h-14 w-14">
            <Image src="/brand/logo-mark.png" alt="Illuvrse logo" fill sizes="56px" />
          </div>
          <div>
            <div className="font-heading text-3xl text-[var(--color-primary-accessible)]">illuvrse</div>
            <div className="text-sm">© {new Date().getFullYear()} Illuvrse Studios</div>
          </div>
        </div>

        <nav className="flex flex-wrap items-center justify-center gap-6 text-base" aria-label="Footer navigation">
          {NAV_LINKS.map((item) => (
            <Link key={item.href} href={item.href} className="hover:text-[var(--color-primary-accessible)]">
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center justify-end gap-4">
          {SOCIAL.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              target="_blank"
              rel="noreferrer"
              aria-label={item.label}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-[var(--color-outline)] text-[var(--color-primary-accessible)] transition hover:bg-[var(--color-surface)]"
            >
              <span className="font-accent text-sm uppercase">{item.icon}</span>
            </Link>
          ))}
        </div>
      </div>
    </footer>
  );
}
