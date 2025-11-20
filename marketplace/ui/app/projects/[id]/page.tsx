import { notFound } from 'next/navigation';
import Container from '@/components/ui/Container';
import { getProject } from '@/lib/api';
import ProjectDetail from '@/components/projects/ProjectDetail';

export const dynamic = 'force-dynamic';

interface ProjectPageProps {
  params: { id: string };
}

export default async function ProjectPage({ params }: ProjectPageProps) {
  try {
    const project = await getProject(params.id);
    return (
      <div className="bg-[var(--color-surface)] py-16">
        <Container>
          <ProjectDetail project={project} />
        </Container>
      </div>
    );
  } catch (error) {
    notFound();
  }
}
