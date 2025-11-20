import { listProjects } from '@/lib/api';
import ProjectShowcase from '@/components/projects/ProjectShowcase';
import Container from '@/components/ui/Container';

export const dynamic = 'force-dynamic';

export default async function MarketplacePage() {
  const projects = await listProjects();

  return (
    <div className="bg-[var(--color-surface)] py-16">
      <Container>
        <header className="mb-10 text-center">
          <p className="font-accent text-sm uppercase tracking-[0.5em] text-[var(--color-text-muted)]">Marketplace</p>
          <h1 className="mt-3 font-heading text-5xl text-[var(--color-primary-accessible)]">Illuvrse Shelves</h1>
          <p className="mt-2 text-base text-[var(--color-text-muted)]">
            Curated manifests ready for preview, signing, and delivery.
          </p>
        </header>
        <ProjectShowcase projects={projects} />
      </Container>
    </div>
  );
}
