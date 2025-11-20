import { tokens } from '@/styles/tokens';

const COLOR_ORDER = [
  { key: 'primary', label: 'Primary' },
  { key: 'primaryLight', label: 'Primary Light' },
  { key: 'primaryDark', label: 'Primary Dark' },
  { key: 'primaryAccessible', label: 'Primary Accessible' },
  { key: 'accentGold', label: 'Accent Gold' },
  { key: 'accentGoldDark', label: 'Accent Gold Dark' },
  { key: 'accentGoldAccessible', label: 'Accent Gold Accessible' },
  { key: 'backgroundLight', label: 'Background Light' },
  { key: 'backgroundDark', label: 'Background Dark' },
  { key: 'glow', label: 'Glow' },
];

const FONT_SAMPLES = [
  {
    label: 'Heading — Cormorant Garamond',
    className: 'font-heading',
    sample: 'Illuvrse Luminous Editorial',
  },
  {
    label: 'Body — Inter',
    className: '',
    sample: 'Kernel-signed manifests with auditable preview trails.',
  },
  {
    label: 'Accent — Space Grotesk',
    className: 'font-accent',
    sample: 'Space Grotesk · System labels & telemetry UI',
  },
];

export default function TokensPage() {
  return (
    <div className="bg-[var(--color-surface)] pb-24 pt-16">
      <div className="mx-auto max-w-6xl px-6">
        <header className="mb-12 text-center">
          <p className="font-accent text-sm uppercase tracking-[0.5em] text-[var(--color-text-muted)]">Design System</p>
          <h1 className="mt-4 font-heading text-5xl text-[var(--color-primary-accessible)]">Illuvrse Tokens</h1>
          <p className="mt-3 text-lg text-[var(--color-text-muted)]">
            The Illuvrse palette, typography, spacing, and radii extracted from the supplied brand comps.
          </p>
        </header>

        <section className="mb-14">
          <h2 className="font-heading text-3xl text-[var(--color-primary-accessible)]">Color Palette</h2>
          <div className="mt-6 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {COLOR_ORDER.map(({ key, label }) => {
              const value = tokens.colors[key as keyof typeof tokens.colors];
              return (
                <div key={key} className="rounded-2xl border border-[var(--color-outline)] bg-white p-4 shadow-card">
                  <div className="h-32 w-full rounded-xl" style={{ backgroundColor: value }} />
                <div className="mt-4 font-heading text-2xl text-[var(--color-primary-accessible)]">{label}</div>
                <p className="font-accent text-sm uppercase tracking-[0.3em] text-[var(--color-text-muted)]">
                    {value}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="mb-14">
          <h2 className="font-heading text-3xl text-[var(--color-primary-accessible)]">Typography</h2>
          <div className="mt-6 space-y-6 rounded-3xl border border-[var(--color-outline)] bg-white px-6 py-8 shadow-card">
            {FONT_SAMPLES.map((font) => (
              <div key={font.label}>
                <p className="font-accent text-xs uppercase tracking-[0.4em] text-[var(--color-text-muted)]">{font.label}</p>
                <p className={`mt-2 text-2xl text-[var(--color-text)] ${font.className}`}>{font.sample}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="grid gap-8 md:grid-cols-2">
          <div className="rounded-3xl border border-[var(--color-outline)] bg-white p-6 shadow-card">
            <h3 className="font-heading text-2xl text-[var(--color-primary-accessible)]">Spacing Scale</h3>
            <ul className="mt-4 space-y-2 text-sm text-[var(--color-text-muted)]">
              {Object.entries(tokens.spacing).map(([key, value]) => (
                <li key={key} className="flex items-center justify-between">
                  <span className="font-accent uppercase tracking-widest">{key}</span>
                  <span>{value}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-3xl border border-[var(--color-outline)] bg-white p-6 shadow-card">
            <h3 className="font-heading text-2xl text-[var(--color-primary-accessible)]">Radii & Shadows</h3>
            <ul className="mt-4 space-y-4 text-sm text-[var(--color-text-muted)]">
              {Object.entries(tokens.radii).map(([key, value]) => (
                <li key={key} className="flex items-center justify-between">
                  <span className="font-accent uppercase tracking-widest">{key}</span>
                  <span>{value}</span>
                </li>
              ))}
            </ul>
            <div className="mt-6 rounded-2xl bg-[var(--color-surface)] p-4">
              <p className="font-accent text-xs uppercase tracking-[0.4em] text-[var(--color-text-muted)]">Shadows</p>
              <ul className="mt-3 space-y-2 text-sm">
                {Object.entries(tokens.shadows).map(([key, value]) => (
                  <li key={key} className="flex items-center justify-between">
                    <span>{key}</span>
                    <code className="text-xs">{value}</code>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
