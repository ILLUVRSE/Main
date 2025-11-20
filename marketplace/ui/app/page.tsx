import Link from 'next/link';
import Hero from '@/components/Hero';

const FEATURES = [
  {
    title: 'Kernel-signed manifests',
    copy: 'Every drop is verified through Kernel /api/kernel/sign, carrying tamper-proof custody proofs for collectors.',
  },
  {
    title: 'Preview sandboxes',
    copy: 'Launch sandboxed previews with throttled secrets so reviewers can explore safely before unlocking deliveries.',
  },
  {
    title: 'Royalty-aware contracts',
    copy: 'Ledger-native rev splits and adaptive licensing keep creative, legal, and distribution in sync.',
  },
];

export default function HomePage() {
  return (
    <>
      <Hero />

      <section id="features" className="bg-[var(--color-surface)] py-20">
        <div className="mx-auto max-w-6xl px-6">
          <div className="grid gap-10 md:grid-cols-3">
            {FEATURES.map((feature) => (
              <div key={feature.title} className="rounded-2xl border border-[var(--color-outline)] bg-white/80 p-6 shadow-card">
                <h3 className="font-heading text-2xl text-[var(--color-primary-accessible)]">{feature.title}</h3>
                <p className="mt-3 text-base text-[var(--color-text-muted)]">{feature.copy}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-[var(--color-bg-dark)] py-20 text-white">
        <div className="mx-auto flex max-w-5xl flex-col items-center gap-10 px-6 text-center md:flex-row md:text-left">
          <div className="flex-1">
            <p className="font-accent text-sm uppercase tracking-[0.5em] text-[var(--color-accent-gold)]">Trusted circuits</p>
            <h2 className="mt-4 font-heading text-4xl leading-snug text-white">Signed delivery with luminous telemetry</h2>
            <p className="mt-4 text-base text-white/80">
              Preview, negotiate, and sign manifests without leaving the studio. Illuvrse coordinates audits, payout ledgers,
              and downstream attestations so fans see living provenance across every channel.
            </p>

            <div className="mt-8 flex flex-wrap gap-4">
              <div className="rounded-2xl border border-white/20 px-5 py-4 text-left">
                <div className="font-heading text-3xl">12k+</div>
                <p className="text-sm uppercase tracking-widest text-white/70">Signed manifests</p>
              </div>
              <div className="rounded-2xl border border-white/20 px-5 py-4 text-left">
                <div className="font-heading text-3xl">$48M</div>
                <p className="text-sm uppercase tracking-widest text-white/70">Creator royalties</p>
              </div>
            </div>
          </div>

          <div className="flex-1 rounded-3xl border border-white/10 bg-white/5 p-6 text-left">
            <p className="font-accent text-sm text-[var(--color-glow)]">Preview Flow</p>
            <ol className="mt-4 space-y-4 text-left text-base">
              <li>
                <span className="font-accent text-[var(--color-accent-gold)]">01 ·</span> Open a draft project from the
                marketplace shelf.
              </li>
              <li>
                <span className="font-accent text-[var(--color-accent-gold)]">02 ·</span> Launch the Preview Modal for manifest
                JSON and media.
              </li>
              <li>
                <span className="font-accent text-[var(--color-accent-gold)]">03 ·</span> Request signing — Kernel responds with
                a manifestSignatureId for audit trails.
              </li>
            </ol>
            <Link href="/projects" className="mt-6 inline-flex items-center gap-2 text-[var(--color-glow)]">
              Browse live projects →
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
