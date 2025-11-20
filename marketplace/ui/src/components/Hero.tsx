import Image from 'next/image';
import Link from 'next/link';

export default function Hero() {
  return (
    <section className="relative overflow-hidden bg-[var(--color-bg-light)] py-24">
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="hero-glow h-72 w-72 rounded-full opacity-70 blur-3xl" />
      </div>

      <div className="relative mx-auto flex max-w-4xl flex-col items-center text-center">
        <div className="relative mb-10 h-48 w-48">
          <div className="absolute inset-0 rounded-full bg-[var(--color-glow)] opacity-30 blur-3xl" />
          <Image src="/brand/logo-mark.png" alt="Illuvrse lighthouse mark" fill sizes="192px" priority />
        </div>

        <p className="font-accent uppercase tracking-[0.3em] text-[var(--color-text-muted)]">Illuvrse Studios</p>

        <h1 className="mt-4 font-heading text-5xl md:text-6xl text-[var(--color-primary-accessible)]">
          Luminous markets for verifiable creations
        </h1>

        <p className="mt-6 max-w-2xl text-lg text-[var(--color-text-muted)]">
          Curate, preview, and sign metaverse manifests with auditable proofs. Illuvrse blends editorial craft
          with Kernel-grade signing so every asset arrives trusted, licensed, and glowing with provenance.
        </p>

        <div className="mt-8 flex flex-wrap justify-center gap-4">
          <Link href="/marketplace" className="btn-primary text-base">
            Explore marketplace
          </Link>
          <Link href="/tokens" className="btn-outline text-base">
            View tokens
          </Link>
        </div>
      </div>
    </section>
  );
}
