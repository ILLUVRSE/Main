import Image from 'next/image';
import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Project } from '@/types/project';

export interface ProductCardProps {
  project: Project;
}

export function ProductCard({ project }: ProductCardProps) {
  return (
    <Card className="overflow-hidden p-0">
      <div className="relative aspect-[3/2]">
        <Image src={project.thumbnail} alt={project.name} fill className="object-cover" sizes="400px" />
      </div>
      <div className="flex flex-col gap-4 p-6">
        <Badge variant="outline">{project.status}</Badge>
        <h3 className="font-heading text-2xl text-[var(--color-primary-accessible)]">{project.name}</h3>
        <p className="text-base text-[var(--color-text-muted)]">{project.summary}</p>
        <div className="flex items-center justify-between">
          <span className="font-heading text-2xl text-[var(--color-primary-accessible)]">
            {project.currency} {project.price.toLocaleString()}
          </span>
          <Link
            href={`/projects/${project.slug}`}
            className="rounded-2xl bg-[var(--color-primary)] px-4 py-2 text-white transition hover:bg-[var(--color-primary-accessible)]"
          >
            View
          </Link>
        </div>
      </div>
    </Card>
  );
}

export default ProductCard;
