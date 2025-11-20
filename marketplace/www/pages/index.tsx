import Head from "next/head";

export default function Home() {
  return (
    <>
      <Head>
        <title>ILLUVRSE Marketplace</title>
      </Head>
      <main className="min-h-screen px-6 py-16">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-sm uppercase tracking-[0.3em] text-brand-accent">Marketplace</p>
          <h1 className="mt-2 text-4xl font-semibold text-white">Coming soon</h1>
          <p className="mt-4 text-slate-300">
            The next-generation storefront is being assembled. This placeholder will be replaced with the
            catalog, streaming previews, and checkout experience described in the spec.
          </p>
        </div>
      </main>
    </>
  );
}
