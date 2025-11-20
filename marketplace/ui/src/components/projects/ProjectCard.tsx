import Image from 'next/image';
import Link from 'next/link';
import { Project } from '@/types/project';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

export interface ProjectCardProps {
  project: Project;
  onPreview?: (project: Project) => void;
}

export function ProjectCard({ project, onPreview }: ProjectCardProps) {
  const imageSrc = project.thumbnail || '/brand/hero-composite.png';
  const statusLabel = project.status;

  return (
    <Card className="flex flex-col overflow-hidden bg-white p-0">
      <Link href={`/projects/${project.slug}`} className="relative block aspect-[3/2]">
        <Image
          src={imageSrc}
          alt={project.name}
          fill
          sizes="(min-width: 1024px) 400px, 100vw"
          className="object-cover"
        />
      </Link>

      <div className="flex flex-1 flex-col gap-4 p-6">
        <div className="flex gap-2">
          <Badge variant="accent">{project.category}</Badge>
          <Badge variant="outline">{statusLabel}</Badge>
        </div>
        <div>
          <h3 className="font-heading text-3xl text-[var(--color-primary-accessible)]">{project.name}</h3>
          <p className="mt-2 text-base text-[var(--color-text-muted)]">{project.summary}</p>
        </div>

        <div className="mt-auto flex items-center justify-between">
          <div>
            <p className="font-accent text-xs uppercase tracking-[0.4em] text-[var(--color-text-muted)]">Edition</p>
            <p className="font-heading text-2xl text-[var(--color-primary-accessible)]">
              #{project.metrics.edition.toString().padStart(3, '0')}
            </p>
          </div>
          <div className="text-right">
            <p className="text-sm text-[var(--color-text-muted)]">From</p>
            <p className="font-heading text-2xl text-[var(--color-primary-accessible)]">
              {project.currency} {project.price.toLocaleString()}
            </p>
          </div>
        </div>

        <div className="flex gap-3">
          <Button variant="secondary" className="flex-1" onClick={() => onPreview?.(project)}>
            Preview
          </Button>
          <Link
            href={`/projects/${project.slug}`}
            className="flex-1 rounded-2xl bg-[var(--color-primary)] px-4 py-3 text-center font-semibold text-white transition hover:bg-[var(--color-primary-accessible)]"
          >
            Open
          </Link>
        </div>
      </div>
    </Card>
  );
}

export default ProjectCard;
