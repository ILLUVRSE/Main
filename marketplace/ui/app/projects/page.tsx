import ProductCard from '@/components/projects/ProductCard';
import Container from '@/components/ui/Container';
import { listProjects } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default async function ProjectsPage() {
  const projects = await listProjects();

  return (
    <div className="bg-[var(--color-bg-light)] py-16">
      <Container>
        <header className="mb-12 text-center">
          <p className="font-accent text-sm uppercase tracking-[0.4em] text-[var(--color-text-muted)]">Projects</p>
          <h1 className="mt-3 font-heading text-5xl text-[var(--color-primary-accessible)]">Featured drops</h1>
          <p className="mt-2 text-base text-[var(--color-text-muted)]">
            Dive into commissioned manifests, editorial cases, and live experiences.
          </p>
        </header>

        <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <ProductCard key={project.id} project={project} />
          ))}
        </div>
      </Container>
    </div>
  );
}
